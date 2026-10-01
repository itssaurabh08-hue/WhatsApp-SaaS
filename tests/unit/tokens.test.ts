import { afterEach, describe, expect, it, vi } from "vitest";
import { generateToken, hashToken } from "@/server/auth/tokens";

describe("tokens", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("generates 256-bit url-safe random tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toEqual(b);
  });

  it("hashes deterministically and never returns the token itself", () => {
    const token = generateToken();
    expect(hashToken(token)).toEqual(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });

  it("depends on AUTH_SECRET", () => {
    const token = generateToken();
    const first = hashToken(token);
    vi.stubEnv("AUTH_SECRET", "a-completely-different-secret-of-32-chars");
    expect(hashToken(token)).not.toEqual(first);
  });

  it("refuses to hash without a sufficiently long secret", () => {
    vi.stubEnv("AUTH_SECRET", "short");
    expect(() => hashToken("x")).toThrow(/AUTH_SECRET/);
  });
});
