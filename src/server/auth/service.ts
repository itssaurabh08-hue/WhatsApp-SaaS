import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit/audit";
import { db } from "@/server/db/client";
import { getEmailProvider } from "@/server/email/provider";
import { passwordResetMessage, verifyEmailMessage } from "@/server/email/templates";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logging/logger";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";
import type { RequestMeta } from "@/server/request-meta";
import { hashPassword, verifyPassword } from "./password";
import { createSession, invalidateAllUserSessions } from "./session-store";
import { generateToken, hashToken } from "./tokens";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

type Meta = Partial<RequestMeta>;

function appUrl(path: string) {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return new URL(path, base).toString();
}

export async function signUp(input: { name: string; email: string; password: string }, meta: Meta = {}) {
  await enforceRateLimit(RATE_LIMITS.signupByIp, meta.ipAddress);
  const passwordHash = await hashPassword(input.password);
  let user;
  try {
    user = await db.user.create({
      data: { name: input.name, email: input.email, passwordHash },
      select: { id: true, name: true, email: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", {
        message: "signup with existing email",
        userMessage: "An account with this email already exists. Sign in or reset your password.",
      });
    }
    throw error;
  }
  await audit({ action: "user.signup", actorUserId: user.id, entityType: "User", entityId: user.id }, meta);
  await sendVerificationEmail(user.id).catch((err) =>
    logger.error({ err, userId: user.id }, "failed to send verification email"),
  );
  const session = await createSession(user.id, meta);
  return { user, session };
}

export async function authenticate(input: { email: string; password: string }, meta: Meta = {}) {
  await enforceRateLimit(RATE_LIMITS.loginByIp, meta.ipAddress);
  await enforceRateLimit(RATE_LIMITS.loginByEmail, input.email);

  const user = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true, passwordHash: true },
  });
  const valid = await verifyPassword(user?.passwordHash, input.password);
  if (!user || !valid) {
    await audit(
      { action: "user.login_failed", actorUserId: user?.id ?? null, metadata: { reason: "invalid_credentials" } },
      meta,
    );
    throw new AppError("UNAUTHENTICATED", {
      message: "invalid credentials",
      userMessage: "Incorrect email or password.",
    });
  }
  await audit({ action: "user.login", actorUserId: user.id, entityType: "User", entityId: user.id }, meta);
  const session = await createSession(user.id, meta);
  return { ...session, userId: user.id };
}

export async function sendVerificationEmail(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, emailVerifiedAt: true },
  });
  if (!user || user.emailVerifiedAt) return;
  const token = generateToken();
  await db.emailVerificationToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) },
  });
  const url = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  await getEmailProvider().send(verifyEmailMessage(user.email, user.name, url));
}

export async function resendVerificationEmail(userId: string) {
  await enforceRateLimit(RATE_LIMITS.verifyEmailResendByUser, userId);
  await sendVerificationEmail(userId);
}

/** Consumes a verification token. Single use; atomic against concurrent submissions. */
export async function verifyEmail(token: string, meta: Meta = {}) {
  const tokenHash = hashToken(token);
  const now = new Date();
  const record = await db.emailVerificationToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt <= now) {
    throw new AppError("VALIDATION", {
      message: "invalid or expired verification token",
      userMessage: "This verification link is invalid or has expired. Request a new one.",
    });
  }
  const claimed = await db.emailVerificationToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) {
    throw new AppError("VALIDATION", { userMessage: "This verification link has already been used." });
  }
  await db.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } });
  await audit(
    { action: "user.email_verified", actorUserId: record.userId, entityType: "User", entityId: record.userId },
    meta,
  );
  return { userId: record.userId };
}

/** Always resolves the same way whether or not the account exists, to avoid account enumeration. */
export async function requestPasswordReset(email: string, meta: Meta = {}) {
  await enforceRateLimit(RATE_LIMITS.passwordResetByIp, meta.ipAddress);
  await enforceRateLimit(RATE_LIMITS.passwordResetByEmail, email);
  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
  if (!user) return;
  const token = generateToken();
  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) },
  });
  await audit(
    { action: "user.password_reset_requested", actorUserId: user.id, entityType: "User", entityId: user.id },
    meta,
  );
  const url = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  await getEmailProvider()
    .send(passwordResetMessage(user.email, user.name, url))
    .catch((err) => logger.error({ err, userId: user.id }, "failed to send password reset email"));
}

/** Sets a new password, consumes the token and signs out every existing session. */
export async function resetPassword(token: string, newPassword: string, meta: Meta = {}) {
  const tokenHash = hashToken(token);
  const now = new Date();
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt <= now) {
    throw new AppError("VALIDATION", {
      message: "invalid or expired reset token",
      userMessage: "This reset link is invalid or has expired. Request a new one.",
    });
  }
  const claimed = await db.passwordResetToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) {
    throw new AppError("VALIDATION", { userMessage: "This reset link has already been used." });
  }
  const passwordHash = await hashPassword(newPassword);
  // Completing a reset proves control of the inbox, so the email counts as verified.
  await db.user.update({ where: { id: record.userId }, data: { passwordHash } });
  await db.user.updateMany({ where: { id: record.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
  await db.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: now } });
  await invalidateAllUserSessions(record.userId);
  await audit(
    { action: "user.password_reset", actorUserId: record.userId, entityType: "User", entityId: record.userId },
    meta,
  );
  return { userId: record.userId };
}
