import "server-only";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logging/logger";
import { getRedis } from "@/server/redis";

export interface RateLimitRule {
  /** Logical bucket name, e.g. "login:ip". */
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  loginByIp: { name: "login:ip", limit: 20, windowSeconds: 15 * 60 },
  loginByEmail: { name: "login:email", limit: 10, windowSeconds: 15 * 60 },
  signupByIp: { name: "signup:ip", limit: 10, windowSeconds: 60 * 60 },
  passwordResetByIp: { name: "reset:ip", limit: 10, windowSeconds: 60 * 60 },
  passwordResetByEmail: { name: "reset:email", limit: 3, windowSeconds: 60 * 60 },
  verifyEmailResendByUser: { name: "verify:user", limit: 5, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counter in Redis. If Redis is unreachable we fail open and log
 * an error: locking every user out of login during a Redis outage is worse
 * than temporarily losing throttling.
 */
export async function checkRateLimit(
  rule: RateLimitRule,
  key: string,
): Promise<{ allowed: boolean; remaining: number }> {
  if (process.env.RATE_LIMIT_DISABLED === "true") return { allowed: true, remaining: rule.limit };
  const redisKey = `rl:${rule.name}:${key.toLowerCase()}`;
  try {
    const redis = getRedis();
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, rule.windowSeconds);
    return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count) };
  } catch (error) {
    logger.error({ err: error, rule: rule.name }, "rate limiter unavailable, failing open");
    return { allowed: true, remaining: rule.limit };
  }
}

export async function enforceRateLimit(rule: RateLimitRule, key: string | null | undefined): Promise<void> {
  if (!key) return;
  const { allowed } = await checkRateLimit(rule, key);
  if (!allowed) throw new AppError("RATE_LIMITED", { message: `rate limit exceeded: ${rule.name}` });
}
