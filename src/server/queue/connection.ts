import IORedis from "ioredis";

/** Dedicated connection for BullMQ (workers need maxRetriesPerRequest: null). */
export function createQueueConnection() {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
}

/**
 * Key prefix for all queues. Give each environment sharing a Redis server its
 * own prefix (e.g. tests vs. development) so they never consume each other's jobs.
 */
export function queuePrefix() {
  return process.env.QUEUE_PREFIX || "whatsflow";
}
