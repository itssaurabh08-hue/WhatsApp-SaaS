import "server-only";
import { randomInt } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit/audit";
import { requirePermission, type TenantContext } from "@/server/authz/tenant";
import { db, systemDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logging/logger";
import { getPlatformConfig, getWhatsAppProvider } from "@/server/providers/whatsapp";
import { MetaApiError } from "@/server/providers/whatsapp/meta/errors";
import type { PhoneNumberDetails } from "@/server/providers/whatsapp/types";
import type { RequestMeta } from "@/server/request-meta";
import { deleteCredentials, readCredential, storeCredential } from "./credentials";

type Meta = Partial<RequestMeta>;

export const PUBLIC_ACCOUNT_SELECT = {
  id: true,
  businessAccountId: true,
  phoneNumberId: true,
  displayPhoneNumber: true,
  verifiedName: true,
  status: true,
  statusDetail: true,
  qualityRating: true,
  messagingLimit: true,
  nameStatus: true,
  codeVerificationStatus: true,
  throughputLevel: true,
  webhooksSubscribedAt: true,
  registeredAt: true,
  lastSyncedAt: true,
  createdAt: true,
} satisfies Prisma.WhatsAppAccountSelect;

/** Accounts for display. Never includes credential references. */
export async function listWhatsAppAccounts(ctx: TenantContext) {
  requirePermission(ctx, "whatsapp:read");
  return db.whatsAppAccount.findMany({
    where: { workspaceId: ctx.workspaceId, status: { not: "DISCONNECTED" } },
    orderBy: { createdAt: "asc" },
    select: PUBLIC_ACCOUNT_SELECT,
  });
}

function toUserError(error: unknown, fallback: string): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof MetaApiError) {
    return new AppError("VALIDATION", { message: error.message, userMessage: error.info.userMessage, cause: error });
  }
  logger.error({ err: error }, "whatsapp connection error");
  return new AppError("INTERNAL", { message: String(error), userMessage: fallback, cause: error });
}

function detailsData(d: PhoneNumberDetails) {
  return {
    displayPhoneNumber: d.displayPhoneNumber,
    verifiedName: d.verifiedName,
    qualityRating: d.qualityRating,
    nameStatus: d.nameStatus,
    codeVerificationStatus: d.codeVerificationStatus,
    messagingLimit: d.messagingLimit,
    throughputLevel: d.throughputLevel,
    lastSyncedAt: new Date(),
  };
}

export interface EmbeddedSignupResult {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  businessId?: string | null;
}

/**
 * Completes onboarding after Embedded Signup (WA/embedded-signup/onboarding-customers-as-a-tech-provider):
 * 1. exchange the code for a business token (must happen within 30 s of the flow finishing)
 * 2. confirm the token can access the returned WABA and phone number (rejects forged IDs)
 * 3. subscribe our app to the WABA's webhooks
 * 4. register the phone number for Cloud API with a generated two-step PIN
 * Credentials are stored encrypted. If steps 3-4 fail, the account is kept in
 * PENDING_SETUP so setup can be retried without repeating the popup.
 */
export async function completeEmbeddedSignup(ctx: TenantContext, input: EmbeddedSignupResult, meta: Meta = {}) {
  requirePermission(ctx, "whatsapp:manage");
  if (!ctx.user.emailVerifiedAt) {
    throw new AppError("FORBIDDEN", { userMessage: "Verify your email address before connecting WhatsApp." });
  }
  if (!getPlatformConfig())
    throw new AppError("VALIDATION", { userMessage: "WhatsApp connection is not configured on this server." });

  const provider = getWhatsAppProvider();
  const callCtx = { workspaceId: ctx.workspaceId, requestId: meta.requestId ?? null };

  // Cross-tenant by design: a phone number may belong to only one workspace.
  const existing = await systemDb.whatsAppAccount.findUnique({
    where: { phoneNumberId: input.phoneNumberId },
    select: { workspaceId: true, status: true },
  });
  if (existing && existing.workspaceId !== ctx.workspaceId && existing.status !== "DISCONNECTED") {
    throw new AppError("CONFLICT", { userMessage: "This phone number is already connected to another workspace." });
  }

  let token: string;
  try {
    token = await provider.exchangeSignupCode(input.code, callCtx);
  } catch (error) {
    throw toUserError(error, "We could not complete the connection with Meta. Please try connecting again.");
  }

  let numbers: PhoneNumberDetails[];
  try {
    numbers = await provider.listPhoneNumbers(input.wabaId, token, callCtx);
  } catch (error) {
    throw toUserError(error, "We could not read your WhatsApp Business account. Please try connecting again.");
  }
  const phone = numbers.find((n) => n.phoneNumberId === input.phoneNumberId);
  if (!phone) {
    throw new AppError("VALIDATION", {
      message: "phone number not found on WABA for this token",
      userMessage: "The selected phone number was not shared with this app. Please try connecting again.",
    });
  }

  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const [tokenRef, pinRef] = await Promise.all([
    storeCredential(ctx.workspaceId, "meta_business_token", token),
    storeCredential(ctx.workspaceId, "meta_registration_pin", pin),
  ]);

  // Reconnecting a previously disconnected number reuses its row. Writes are conditional so a
  // concurrent connection from another workspace can never take over an active number.
  const old = await systemDb.whatsAppAccount.findUnique({
    where: { phoneNumberId: input.phoneNumberId },
    select: { id: true, accessTokenRef: true, registrationPinRef: true, workspaceId: true },
  });
  const fields = {
    businessAccountId: input.wabaId,
    businessPortfolioId: input.businessId ?? null,
    accessTokenRef: tokenRef,
    registrationPinRef: pinRef,
    connectedById: ctx.user.id,
    status: "PENDING_SETUP" as const,
    displayPhoneNumber: phone.displayPhoneNumber,
    verifiedName: phone.verifiedName,
    qualityRating: phone.qualityRating,
  };
  let account: { id: string };
  try {
    if (old) {
      const taken = await systemDb.whatsAppAccount.updateMany({
        where: { id: old.id, OR: [{ workspaceId: ctx.workspaceId }, { status: "DISCONNECTED" }] },
        data: {
          ...fields,
          workspaceId: ctx.workspaceId,
          statusDetail: null,
          webhooksSubscribedAt: null,
          registeredAt: null,
        },
      });
      if (taken.count !== 1)
        throw new AppError("CONFLICT", { userMessage: "This phone number is already connected to another workspace." });
      await deleteCredentials(old.workspaceId, [old.accessTokenRef, old.registrationPinRef]);
      account = { id: old.id };
    } else {
      account = await db.whatsAppAccount.create({
        data: { ...fields, workspaceId: ctx.workspaceId, phoneNumberId: input.phoneNumberId },
        select: { id: true },
      });
    }
  } catch (error) {
    await deleteCredentials(ctx.workspaceId, [tokenRef, pinRef]);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", { userMessage: "This phone number is already connected to another workspace." });
    }
    throw error;
  }

  await finishSetup(ctx, account.id, meta);
  return account;
}

/** Runs the remaining onboarding steps (subscribe, register, sync). Safe to call again after a failure. */
export async function finishSetup(ctx: TenantContext, accountId: string, meta: Meta = {}) {
  requirePermission(ctx, "whatsapp:manage");
  const account = await db.whatsAppAccount.findFirst({ where: { id: accountId, workspaceId: ctx.workspaceId } });
  if (!account || !account.accessTokenRef || !account.registrationPinRef) throw new AppError("NOT_FOUND");
  const provider = getWhatsAppProvider();
  const callCtx = { workspaceId: ctx.workspaceId, whatsappAccountId: account.id, requestId: meta.requestId ?? null };
  const token = await readCredential(ctx.workspaceId, account.accessTokenRef);

  try {
    if (!account.webhooksSubscribedAt) {
      await provider.subscribeAppToWaba(account.businessAccountId, token, callCtx);
      await db.whatsAppAccount.updateMany({
        where: { id: account.id, workspaceId: ctx.workspaceId },
        data: { webhooksSubscribedAt: new Date() },
      });
    }
    if (!account.registeredAt) {
      const pin = await readCredential(ctx.workspaceId, account.registrationPinRef);
      await provider.registerPhoneNumber(account.phoneNumberId, pin, token, callCtx);
      await db.whatsAppAccount.updateMany({
        where: { id: account.id, workspaceId: ctx.workspaceId },
        data: { registeredAt: new Date() },
      });
    }
    const details = await provider.getPhoneNumber(account.phoneNumberId, token, callCtx);
    await db.whatsAppAccount.updateMany({
      where: { id: account.id, workspaceId: ctx.workspaceId },
      data: { ...detailsData(details), status: "CONNECTED", statusDetail: null },
    });
  } catch (error) {
    const appError = toUserError(error, "Setting up the phone number failed. Try again.");
    const needsReconnect = error instanceof MetaApiError && error.info.category === "auth";
    await db.whatsAppAccount.updateMany({
      where: { id: account.id, workspaceId: ctx.workspaceId },
      data: { status: needsReconnect ? "NEEDS_RECONNECT" : "PENDING_SETUP", statusDetail: appError.userMessage },
    });
    await audit(
      {
        action: "whatsapp.setup_failed",
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user.id,
        entityType: "WhatsAppAccount",
        entityId: account.id,
        metadata: { metaCode: error instanceof MetaApiError ? error.code : null },
      },
      meta,
    );
    throw appError;
  }

  await audit(
    {
      action: "whatsapp.connected",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "WhatsAppAccount",
      entityId: account.id,
      metadata: { phoneNumberId: account.phoneNumberId, wabaId: account.businessAccountId },
    },
    meta,
  );
  if (ctx.workspace.onboardingStep === "WHATSAPP" || ctx.workspace.onboardingStep === "BUSINESS") {
    await db.workspace.update({ where: { id: ctx.workspaceId }, data: { onboardingStep: "CONTACTS" } });
  }
}

/** Refreshes quality rating, limits and name status from Meta. */
export async function syncAccount(ctx: TenantContext, accountId: string, meta: Meta = {}) {
  requirePermission(ctx, "whatsapp:manage");
  const account = await db.whatsAppAccount.findFirst({ where: { id: accountId, workspaceId: ctx.workspaceId } });
  if (!account?.accessTokenRef) throw new AppError("NOT_FOUND");
  const token = await readCredential(ctx.workspaceId, account.accessTokenRef);
  try {
    const details = await getWhatsAppProvider().getPhoneNumber(account.phoneNumberId, token, {
      workspaceId: ctx.workspaceId,
      whatsappAccountId: account.id,
      requestId: meta.requestId ?? null,
    });
    await db.whatsAppAccount.updateMany({
      where: { id: account.id, workspaceId: ctx.workspaceId },
      data: detailsData(details),
    });
  } catch (error) {
    if (error instanceof MetaApiError && error.info.category === "auth") {
      await db.whatsAppAccount.updateMany({
        where: { id: account.id, workspaceId: ctx.workspaceId },
        data: { status: "NEEDS_RECONNECT", statusDetail: error.info.userMessage },
      });
    }
    throw toUserError(error, "Could not refresh the account status. Try again.");
  }
}

/**
 * Disconnects the number from this workspace: unsubscribes our app from the
 * WABA's webhooks (best effort) and deletes stored credentials. The number
 * itself stays registered with Meta and owned by the customer.
 */
export async function disconnectAccount(ctx: TenantContext, accountId: string, meta: Meta = {}) {
  requirePermission(ctx, "whatsapp:manage");
  const account = await db.whatsAppAccount.findFirst({ where: { id: accountId, workspaceId: ctx.workspaceId } });
  if (!account) throw new AppError("NOT_FOUND");
  if (account.accessTokenRef) {
    const others = await db.whatsAppAccount.count({
      where: {
        workspaceId: ctx.workspaceId,
        businessAccountId: account.businessAccountId,
        id: { not: account.id },
        status: { not: "DISCONNECTED" },
      },
    });
    if (others === 0) {
      try {
        const token = await readCredential(ctx.workspaceId, account.accessTokenRef);
        await getWhatsAppProvider().unsubscribeAppFromWaba(account.businessAccountId, token, {
          workspaceId: ctx.workspaceId,
          whatsappAccountId: account.id,
          requestId: meta.requestId ?? null,
        });
      } catch (error) {
        logger.warn({ err: error, accountId }, "unsubscribe on disconnect failed; continuing");
      }
    }
  }
  await deleteCredentials(ctx.workspaceId, [account.accessTokenRef, account.registrationPinRef]);
  await db.whatsAppAccount.updateMany({
    where: { id: account.id, workspaceId: ctx.workspaceId },
    data: {
      status: "DISCONNECTED",
      accessTokenRef: null,
      registrationPinRef: null,
      statusDetail: "Disconnected from this workspace.",
    },
  });
  await audit(
    {
      action: "whatsapp.disconnected",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: "WhatsAppAccount",
      entityId: account.id,
    },
    meta,
  );
}
