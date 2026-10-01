import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { getEmailProvider, MemoryEmailProvider } from "@/server/email/provider";
import { isAppError } from "@/server/errors";
import { authenticate, requestPasswordReset, resetPassword, signUp, verifyEmail } from "@/server/auth/service";
import { createSession, validateSessionToken } from "@/server/auth/session-store";
import { createUser } from "../support/factories";

function sentEmails() {
  return (getEmailProvider() as MemoryEmailProvider).sent;
}

function tokenFromLastEmail(path: string) {
  const email = sentEmails().at(-1);
  expect(email).toBeDefined();
  const match = email!.text.match(new RegExp(`${path}\\?token=([A-Za-z0-9_%-]+)`));
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1]!);
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isAppError(error)).toBe(true);
  expect((error as { code: string }).code).toBe(code);
}

describe("signup", () => {
  it("creates a user with a hashed password, a session and a verification email", async () => {
    const { user, session } = await signUp({ name: "Ana", email: "ana@example.com", password: "a-long-password" });
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.emailVerifiedAt).toBeNull();
    expect(await validateSessionToken(session.token)).not.toBeNull();
    expect(sentEmails()).toHaveLength(1);
    expect(sentEmails()[0]!.to).toBe("ana@example.com");
    const audit = await db.auditLog.findFirst({ where: { action: "user.signup", actorUserId: user.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a duplicate email with a user-safe conflict error", async () => {
    await signUp({ name: "Ana", email: "dup@example.com", password: "a-long-password" });
    await expectAppError(signUp({ name: "Ana 2", email: "dup@example.com", password: "another-password" }), "CONFLICT");
  });

  it("stores session ids as hashes, not raw tokens", async () => {
    const { session } = await signUp({ name: "Ana", email: "hash@example.com", password: "a-long-password" });
    const rows = await db.session.findMany();
    expect(rows.some((r) => r.id === session.token)).toBe(false);
  });
});

describe("login", () => {
  it("returns a session for valid credentials and audits the login", async () => {
    const user = await createUser({ email: "login@example.com", password: "correct-horse-battery" });
    const result = await authenticate({ email: "login@example.com", password: "correct-horse-battery" });
    expect(result.userId).toBe(user.id);
    expect((await validateSessionToken(result.token))?.user.id).toBe(user.id);
    expect(await db.auditLog.count({ where: { action: "user.login", actorUserId: user.id } })).toBe(1);
  });

  it("returns the same error for a wrong password and an unknown email", async () => {
    await createUser({ email: "known@example.com", password: "correct-horse-battery" });
    await expectAppError(authenticate({ email: "known@example.com", password: "wrong" }), "UNAUTHENTICATED");
    await expectAppError(authenticate({ email: "unknown@example.com", password: "wrong" }), "UNAUTHENTICATED");
    expect(await db.auditLog.count({ where: { action: "user.login_failed" } })).toBe(2);
  });
});

describe("sessions", () => {
  it("rejects and deletes expired sessions", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(token)).toBeNull();
    expect(await db.session.count()).toBe(0);
  });

  it("rejects unknown tokens", async () => {
    expect(await validateSessionToken("not-a-real-token")).toBeNull();
  });

  it("extends sessions that are past half their lifetime", async () => {
    const user = await createUser();
    const { token } = await createSession(user.id);
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.session.updateMany({ data: { expiresAt: soon } });
    const validated = await validateSessionToken(token);
    expect(validated!.expiresAt.getTime()).toBeGreaterThan(soon.getTime());
  });
});

describe("email verification", () => {
  it("verifies once and rejects reuse", async () => {
    const { user } = await signUp({ name: "Ver", email: "verify@example.com", password: "a-long-password" });
    const token = tokenFromLastEmail("/verify-email");
    await verifyEmail(token);
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.emailVerifiedAt).not.toBeNull();
    await expectAppError(verifyEmail(token), "VALIDATION");
  });

  it("rejects expired tokens", async () => {
    await signUp({ name: "Ver", email: "expired@example.com", password: "a-long-password" });
    const token = tokenFromLastEmail("/verify-email");
    await db.emailVerificationToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await expectAppError(verifyEmail(token), "VALIDATION");
  });
});

describe("password reset", () => {
  it("does not reveal whether an account exists", async () => {
    await expect(requestPasswordReset("nobody@example.com")).resolves.toBeUndefined();
    expect(sentEmails()).toHaveLength(0);
  });

  it("resets the password, consumes the token and signs out all sessions", async () => {
    const user = await createUser({ email: "reset@example.com", password: "old-password-123" });
    const { token: sessionToken } = await createSession(user.id);
    await requestPasswordReset("reset@example.com");
    const resetToken = tokenFromLastEmail("/reset-password");

    await resetPassword(resetToken, "new-password-456");

    expect(await validateSessionToken(sessionToken)).toBeNull();
    await expectAppError(authenticate({ email: "reset@example.com", password: "old-password-123" }), "UNAUTHENTICATED");
    await expect(authenticate({ email: "reset@example.com", password: "new-password-456" })).resolves.toBeTruthy();
    await expectAppError(resetPassword(resetToken, "third-password-789"), "VALIDATION");
  });

  it("invalidates other outstanding reset tokens after a successful reset", async () => {
    await createUser({ email: "multi@example.com" });
    await requestPasswordReset("multi@example.com");
    const first = tokenFromLastEmail("/reset-password");
    await requestPasswordReset("multi@example.com");
    const second = tokenFromLastEmail("/reset-password");
    await resetPassword(second, "new-password-456");
    await expectAppError(resetPassword(first, "another-password-1"), "VALIDATION");
  });
});
