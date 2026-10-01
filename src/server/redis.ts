import "server-only";
import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { __redis?: Redis };

export function getRedis(): Redis {
  if (!globalForRedis.__redis) {
    globalForRedis.__redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      // Queue commands until the first connection is up (otherwise early requests would
      // skip rate limiting), but give up quickly if Redis is actually unavailable.
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
    });
    globalForRedis.__redis.on("error", () => {
      // Connection errors surface on individual commands; avoid unhandled event noise.
    });
  }
  return globalForRedis.__redis;
}
