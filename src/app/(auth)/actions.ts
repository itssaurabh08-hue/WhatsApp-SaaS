"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { safeRedirectPath } from "@/lib/safe-redirect";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  verifyEmailSchema,
} from "@/lib/validation/auth";
import { actionError, fieldErrorsFrom, formValues } from "@/server/actions";
import { audit } from "@/server/audit/audit";
import { defaultLandingPath } from "@/server/auth/landing";
import {
  authenticate,
  requestPasswordReset,
  resendVerificationEmail,
  resetPassword,
  signUp,
  verifyEmail,
} from "@/server/auth/service";
import { deleteSessionCookie, getCurrentSession, getSessionToken, setSessionCookie } from "@/server/auth/session";
import { invalidateSession } from "@/server/auth/session-store";
import { getRequestMeta } from "@/server/request-meta";

type LoginFields = "email" | "password";
export async function loginAction(
  _prev: ActionState<LoginFields>,
  formData: FormData,
): Promise<ActionState<LoginFields>> {
  const values = formValues(formData, ["email"] as const);
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error), values };
  let destination: string;
  try {
    const meta = await getRequestMeta();
    const session = await authenticate(parsed.data, meta);
    await setSessionCookie(session.token, session.expiresAt);
    destination = safeRedirectPath(formData.get("next"), await defaultLandingPath(session.userId));
  } catch (error) {
    return actionError(error, "login", values);
  }
  redirect(destination);
}

type SignupFields = "name" | "email" | "password";
export async function signupAction(
  _prev: ActionState<SignupFields>,
  formData: FormData,
): Promise<ActionState<SignupFields>> {
  const values = formValues(formData, ["name", "email"] as const);
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error), values };
  try {
    const meta = await getRequestMeta();
    const { session } = await signUp(parsed.data, meta);
    await setSessionCookie(session.token, session.expiresAt);
  } catch (error) {
    return actionError(error, "signup", values);
  }
  redirect("/onboarding");
}

export async function logoutAction(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    const session = await getCurrentSession();
    await invalidateSession(token);
    if (session) await audit({ action: "user.logout", actorUserId: session.user.id }, await getRequestMeta());
  }
  await deleteSessionCookie();
  redirect("/login");
}

type ForgotFields = "email";
export async function forgotPasswordAction(
  _prev: ActionState<ForgotFields>,
  formData: FormData,
): Promise<ActionState<ForgotFields>> {
  const values = formValues(formData, ["email"] as const);
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error), values };
  try {
    await requestPasswordReset(parsed.data.email, await getRequestMeta());
  } catch (error) {
    return actionError(error, "forgot-password", values);
  }
  return {
    ok: true,
    message: "If an account exists for that email, we sent a link to reset your password. It expires in 1 hour.",
  };
}

type ResetFields = "password" | "confirmPassword" | "token";
export async function resetPasswordAction(
  _prev: ActionState<ResetFields>,
  formData: FormData,
): Promise<ActionState<ResetFields>> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  try {
    await resetPassword(parsed.data.token, parsed.data.password, await getRequestMeta());
    await deleteSessionCookie();
  } catch (error) {
    return actionError(error, "reset-password");
  }
  redirect("/login?reset=1");
}

export async function verifyEmailAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = verifyEmailSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) return { ok: false, message: "This verification link is invalid." };
  try {
    await verifyEmail(parsed.data.token, await getRequestMeta());
  } catch (error) {
    return actionError(error, "verify-email");
  }
  return { ok: true, message: "Your email address is verified." };
}

export async function resendVerificationAction(): Promise<ActionState> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, message: "Please sign in to continue." };
  if (session.user.emailVerifiedAt) return { ok: true, message: "Your email is already verified." };
  try {
    await resendVerificationEmail(session.user.id);
  } catch (error) {
    return actionError(error, "resend-verification");
  }
  return { ok: true, message: `We sent a new verification link to ${session.user.email}.` };
}
