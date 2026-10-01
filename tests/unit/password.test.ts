import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("password hashing", () => {
  it("produces an argon2id hash that is not the plaintext", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("correct-horse-battery");
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(await verifyPassword(hash, "correct-horse-battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong-password")).toBe(false);
  });

  it("uses a unique salt per hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password-1"), hashPassword("same-password-1")]);
    expect(a).not.toEqual(b);
  });

  it("returns false (not throws) for missing or malformed hashes", async () => {
    expect(await verifyPassword(null, "anything")).toBe(false);
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });
});
