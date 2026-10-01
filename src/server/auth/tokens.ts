import { createHmac, randomBytes } from "node:crypto";

/** 256-bit random token, URL-safe. Only ever sent to the user (cookie or email link). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Keyed hash of a token for storage. Using HMAC with AUTH_SECRET means a
 * database dump alone cannot be used to forge or look up tokens.
 */
export function hashToken(token: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set (min 32 characters)");
  return createHmac("sha256", secret).update(token).digest("hex");
}
