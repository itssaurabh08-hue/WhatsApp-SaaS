import { afterEach, describe, expect, it } from "vitest";
import { db, systemDb } from "@/server/db/client";
import { isAppError } from "@/server/errors";
import { setWhatsAppProviderForTests } from "@/server/providers/whatsapp";
import {
  completeEmbeddedSignup,
  disconnectAccount,
  finishSetup,
  listWhatsAppAccounts,
  syncAccount,
} from "@/server/whatsapp/connection";
import { BUSINESS_TOKEN, happyMeta, metaError, PHONE_ID, WABA_ID, type FakeMeta } from "../support/fake-meta";
import { memberContext, ownerContext } from "../support/factories";

function useMeta(fake: FakeMeta) {
  setWhatsAppProviderForTests(null, fake.fetch);
  return fake;
}

afterEach(() => setWhatsAppProviderForTests(null));

const signup = { code: "AQBcode", wabaId: WABA_ID, phoneNumberId: PHONE_ID, businessId: "2729063490586005" };

async function code(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  return isAppError(e) ? e.code : e;
}

describe("Embedded Signup onboarding", () => {
  it("exchanges the code, subscribes, registers and stores everything encrypted", async () => {
    const meta = useMeta(happyMeta());
    const ctx = await ownerContext();
    const account = await completeEmbeddedSignup(ctx, signup);

    expect(meta.callsTo("GET", /oauth\/access_token/)).toHaveLength(1);
    expect(meta.callsTo("POST", /subscribed_apps/)).toHaveLength(1);
    const register = meta.callsTo("POST", /register/)[0]!;
    expect((register.body as { pin: string }).pin).toMatch(/^\d{6}$/);

    const stored = await db.whatsAppAccount.findFirstOrThrow({
      where: { id: account.id, workspaceId: ctx.workspaceId },
    });
    expect(stored).toMatchObject({
      status: "CONNECTED",
      businessAccountId: WABA_ID,
      verifiedName: "Lucky Shrub",
      qualityRating: "GREEN",
      messagingLimit: "TIER_250",
      nameStatus: "APPROVED",
    });
    expect(stored.registeredAt).not.toBeNull();
    expect(stored.webhooksSubscribedAt).not.toBeNull();

    const creds = await db.credential.findMany({ where: { workspaceId: ctx.workspaceId } });
    expect(creds.map((c) => c.kind).sort()).toEqual(["meta_business_token", "meta_registration_pin"]);
    expect(JSON.stringify(creds)).not.toContain(BUSINESS_TOKEN);

    const logs = await db.providerApiLog.findMany({ where: { workspaceId: ctx.workspaceId } });
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(logs)).not.toContain(BUSINESS_TOKEN);
    expect(await db.auditLog.count({ where: { workspaceId: ctx.workspaceId, action: "whatsapp.connected" } })).toBe(1);

    const listed = await listWhatsAppAccounts(ctx);
    expect(Object.keys(listed[0]!)).not.toContain("accessTokenRef");
  });

  it("rejects IDs the token cannot access (forged or mismatched)", async () => {
    useMeta(happyMeta());
    const ctx = await ownerContext();
    expect(await code(completeEmbeddedSignup(ctx, { ...signup, phoneNumberId: "999999999" }))).toBe("VALIDATION");
    expect(await db.whatsAppAccount.count({ where: { workspaceId: ctx.workspaceId } })).toBe(0);
    expect(await db.credential.count({ where: { workspaceId: ctx.workspaceId } })).toBe(0);
  });

  it("shows a friendly error when the code exchange fails", async () => {
    useMeta(happyMeta().on("GET", /oauth\/access_token/, () => metaError(100, "This authorization code has expired.")));
    const ctx = await ownerContext();
    const err = await completeEmbeddedSignup(ctx, signup).catch((e: unknown) => e);
    expect(isAppError(err) && err.userMessage).toBe("WhatsApp rejected the request as invalid.");
  });

  it("keeps the account in PENDING_SETUP when registration fails, then finishes on retry", async () => {
    const meta = useMeta(happyMeta().on("POST", /register$/, () => metaError(133016, "Too many attempts")));
    const ctx = await ownerContext();
    expect(await code(completeEmbeddedSignup(ctx, signup))).toBe("VALIDATION");
    const pending = await db.whatsAppAccount.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId } });
    expect(pending.status).toBe("PENDING_SETUP");
    expect(pending.statusDetail).toMatch(/72 hours/);
    expect(pending.webhooksSubscribedAt).not.toBeNull();

    meta.on("POST", /register$/, () => ({ json: { success: true } }));
    await finishSetup(ctx, pending.id);
    const done = await db.whatsAppAccount.findFirstOrThrow({ where: { id: pending.id, workspaceId: ctx.workspaceId } });
    expect(done.status).toBe("CONNECTED");
    expect(meta.callsTo("POST", /subscribed_apps/)).toHaveLength(1); // not repeated
  });

  it("marks the account NEEDS_RECONNECT when Meta rejects the token", async () => {
    const meta = useMeta(happyMeta());
    const ctx = await ownerContext();
    const { id } = await completeEmbeddedSignup(ctx, signup);
    meta.on("GET", new RegExp(`^/${PHONE_ID}$`), () => metaError(190, "Session expired", 401));
    expect(await code(syncAccount(ctx, id))).toBe("VALIDATION");
    expect((await db.whatsAppAccount.findFirstOrThrow({ where: { id, workspaceId: ctx.workspaceId } })).status).toBe(
      "NEEDS_RECONNECT",
    );
  });

  it("prevents connecting a number already connected to another workspace", async () => {
    useMeta(happyMeta());
    const a = await ownerContext();
    const b = await ownerContext();
    await completeEmbeddedSignup(a, signup);
    expect(await code(completeEmbeddedSignup(b, signup))).toBe("CONFLICT");
    expect(await db.credential.count({ where: { workspaceId: b.workspaceId } })).toBe(0);
    const row = await systemDb.whatsAppAccount.findUniqueOrThrow({ where: { phoneNumberId: PHONE_ID } });
    expect(row.workspaceId).toBe(a.workspaceId);
  });

  it("disconnect unsubscribes, deletes credentials, and allows another workspace to connect", async () => {
    const meta = useMeta(happyMeta());
    const a = await ownerContext();
    const b = await ownerContext();
    const { id } = await completeEmbeddedSignup(a, signup);
    await disconnectAccount(a, id);
    expect(meta.callsTo("DELETE", /subscribed_apps/)).toHaveLength(1);
    expect(await db.credential.count({ where: { workspaceId: a.workspaceId } })).toBe(0);
    expect(await listWhatsAppAccounts(a)).toEqual([]);

    await completeEmbeddedSignup(b, signup);
    const row = await systemDb.whatsAppAccount.findUniqueOrThrow({ where: { phoneNumberId: PHONE_ID } });
    expect(row).toMatchObject({ workspaceId: b.workspaceId, status: "CONNECTED" });
  });

  it("requires whatsapp:manage and a verified email", async () => {
    useMeta(happyMeta());
    const owner = await ownerContext();
    const agent = await memberContext(owner, "AGENT");
    expect(await code(completeEmbeddedSignup(agent, signup))).toBe("FORBIDDEN");
    const unverified = { ...owner, user: { ...owner.user, emailVerifiedAt: null } };
    expect(await code(completeEmbeddedSignup(unverified, signup))).toBe("FORBIDDEN");
  });

  it("cannot manage another workspace's account", async () => {
    useMeta(happyMeta());
    const a = await ownerContext();
    const b = await ownerContext();
    const { id } = await completeEmbeddedSignup(a, signup);
    expect(await code(disconnectAccount(b, id))).toBe("NOT_FOUND");
    expect(await code(syncAccount(b, id))).toBe("NOT_FOUND");
    expect(await listWhatsAppAccounts(b)).toEqual([]);
  });
});
