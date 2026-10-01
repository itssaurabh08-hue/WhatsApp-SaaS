import { Queue } from "bullmq";
import { logger } from "@/server/logging/logger";
import { createQueueConnection, queuePrefix } from "./connection";

export const WEBHOOK_QUEUE = "webhook-events";

export interface WebhookJobData {
  eventId: string;
}

const globalForQueues = globalThis as unknown as { __webhookQueue?: Queue<WebhookJobData> };

function webhookQueue(): Queue<WebhookJobData> {
  globalForQueues.__webhookQueue ??= new Queue<WebhookJobData>(WEBHOOK_QUEUE, {
    connection: createQueueConnection(),
    prefix: queuePrefix(),
    defaultJobOptions: {
      attempts: 8,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 24 * 3600, count: 10_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return globalForQueues.__webhookQueue;
}

/**
 * Enqueues processing of stored webhook events. jobId = event id makes enqueueing
 * idempotent. If Redis is down the events stay RECEIVED in the database and the
 * worker's sweeper picks them up later, so nothing is lost.
 */
export async function enqueueWebhookEvents(eventIds: string[]) {
  if (eventIds.length === 0) return;
  try {
    await webhookQueue().addBulk(
      eventIds.map((eventId) => ({ name: "process", data: { eventId }, opts: { jobId: eventId } })),
    );
  } catch (error) {
    logger.error({ err: error, count: eventIds.length }, "failed to enqueue webhook events; sweeper will retry");
  }
}
