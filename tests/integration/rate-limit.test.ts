import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, enforceRateLimit } from "@/server/rate-limit";
import { isAppError } from "@/server/errors";

describe("rate limiting (Redis)", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_DISABLED = "false";
  });
  afterEach(() => {
    process.env.RATE_LIMIT_DISABLED = "true";
  });

  it("allows up to the limit and then blocks", async () => {
    const rule = { name: `test:${randomUUID()}`, limit: 3, windowSeconds: 60 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await checkRateLimit(rule, "key")).allowed);
    expect(results).toEqual([true, true, true, false]);
  });

  it("throws a RATE_LIMITED AppError when enforced", async () => {
    const rule = { name: `test:${randomUUID()}`, limit: 1, windowSeconds: 60 };
    await enforceRateLimit(rule, "k");
    const error = await enforceRateLimit(rule, "k").catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("RATE_LIMITED");
  });

  it("keys limits case-insensitively so email casing cannot bypass them", async () => {
    const rule = { name: `test:${randomUUID()}`, limit: 1, windowSeconds: 60 };
    expect((await checkRateLimit(rule, "User@Example.com")).allowed).toBe(true);
    expect((await checkRateLimit(rule, "user@example.com")).allowed).toBe(false);
  });
});

describe("rate limiting when Redis is unavailable", () => {
  it("fails open instead of locking users out", async () => {
    const globalForRedis = globalThis as unknown as { __redis?: { disconnect(): void } };
    const original = globalForRedis.__redis;
    const originalUrl = process.env.REDIS_URL;
    process.env.RATE_LIMIT_DISABLED = "false";
    process.env.REDIS_URL = "redis://127.0.0.1:1"; // nothing listens here
    globalForRedis.__redis = undefined;
    try {
      const result = await checkRateLimit({ name: `test:${randomUUID()}`, limit: 1, windowSeconds: 60 }, "k");
      expect(result.allowed).toBe(true);
    } finally {
      // checkRateLimit created a fresh client pointing at the dead port; dispose of it.
      (globalForRedis.__redis as { disconnect(): void } | undefined)?.disconnect();
      globalForRedis.__redis = original;
      process.env.REDIS_URL = originalUrl;
      process.env.RATE_LIMIT_DISABLED = "true";
    }
  });
});
