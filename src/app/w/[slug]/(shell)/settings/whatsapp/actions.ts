"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/server/actions";
import { getTenantContext } from "@/server/authz/tenant";
import { getRequestMeta } from "@/server/request-meta";
import { completeEmbeddedSignup, disconnectAccount, finishSetup, syncAccount } from "@/server/whatsapp/connection";

type Result = { ok: true; message: string } | { ok: false; message: string };

const signupSchema = z.object({
  code: z.string().min(10).max(2000),
  wabaId: z.string().regex(/^\d{5,30}$/),
  phoneNumberId: z.string().regex(/^\d{5,30}$/),
  businessId: z
    .string()
    .regex(/^\d{5,30}$/)
    .nullish(),
});

const path = (slug: string) => `/w/${slug}/settings/whatsapp`;

export async function completeConnectionAction(slug: string, input: unknown): Promise<Result> {
  const ctx = await getTenantContext(slug);
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "Meta did not return the account details. Please try connecting again." };
  try {
    await completeEmbeddedSignup(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    revalidatePath(path(slug));
    return { ok: false, message: actionError(error, "complete-embedded-signup").message ?? "Connection failed." };
  }
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "WhatsApp is connected." };
}

async function run(slug: string, label: string, fn: () => Promise<unknown>, success: string): Promise<Result> {
  try {
    await fn();
  } catch (error) {
    revalidatePath(path(slug));
    return { ok: false, message: actionError(error, label).message ?? "Something went wrong." };
  }
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: success };
}

export async function retrySetupAction(slug: string, accountId: string): Promise<Result> {
  const ctx = await getTenantContext(slug);
  return run(
    slug,
    "retry-whatsapp-setup",
    async () => finishSetup(ctx, accountId, await getRequestMeta()),
    "Setup completed.",
  );
}

export async function syncAccountAction(slug: string, accountId: string): Promise<Result> {
  const ctx = await getTenantContext(slug);
  return run(
    slug,
    "sync-whatsapp-account",
    async () => syncAccount(ctx, accountId, await getRequestMeta()),
    "Status refreshed.",
  );
}

export async function disconnectAccountAction(slug: string, accountId: string): Promise<Result> {
  const ctx = await getTenantContext(slug);
  return run(
    slug,
    "disconnect-whatsapp-account",
    async () => disconnectAccount(ctx, accountId, await getRequestMeta()),
    "Disconnected.",
  );
}
