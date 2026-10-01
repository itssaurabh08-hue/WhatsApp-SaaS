import "server-only";
import { getRedis } from "@/server/redis";
import { logger } from "@/server/logging/logger";

/**
 * Messages per second each business number may send. Meta's documented default
 * throughput is 80 messages/second per number (error 130429 above it); we stay
 * below it by default. Raise it for numbers Meta has upgraded.
 */
export function sendRatePerSecond() {
  const n = Number(process.env.WHATSAPP_SEND_RATE_PER_SECOND || 20);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 20;
}

/**
 * Takes one send slot for this number in the current second (Redis fixed window,
 * shared by all worker processes). Returns false when the number is at its limit.
 * Fails open if Redis is unavailable: Meta's own limit (130429) is retried anyway.
 */
export async function takeSendSlot(whatsappAccountId: string, now = Date.now()): Promise<boolean> {
  const key = `${process.env.QUEUE_PREFIX || "whatsflow"}:send-rate:${whatsappAccountId}:${Math.floor(now / 1000)}`;
  try {
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 2);
    return count <= sendRatePerSecond();
  } catch (error) {
    logger.warn({ err: error }, "send rate check failed; allowing send");
    return true;
  }
}
