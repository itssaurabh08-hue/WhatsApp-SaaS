import { Queue, type JobsOptions } from "bullmq";
import { logger } from "@/server/logging/logger";
import { createQueueConnection, queuePrefix } from "./connection";

export const WEBHOOK_QUEUE = "webhook-events";
export const OUTBOUND_QUEUE = "outbound-messages";
export const MEDIA_QUEUE = "media-downloads";

export interface WebhookJobData {
  eventId: string;
}
export interface OutboundJobData {
  messageId: string;
  whatsappAccountId?: string;
}
export interface MediaJobData {
  mediaObjectId: string;
  workspaceId: string;
  whatsappAccountId: string;
}

const DEFAULTS: Record<string, JobsOptions> = {
  [WEBHOOK_QUEUE]: {
    attempts: 8,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
  // Sends retry only on errors where Meta did not accept the message (see messaging/delivery.ts).
  [OUTBOUND_QUEUE]: {
    attempts: 5,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
  // Incoming media ids stay downloadable for 7 days.
  [MEDIA_QUEUE]: {
    attempts: 6,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
};

const globalForQueues = globalThis as unknown as { __queues?: Map<string, Queue> };

export function getQueue<T>(name: string): Queue<T> {
  globalForQueues.__queues ??= new Map();
  let queue = globalForQueues.__queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: createQueueConnection(),
      prefix: queuePrefix(),
      defaultJobOptions: DEFAULTS[name],
    });
    globalForQueues.__queues.set(name, queue);
  }
  return queue as unknown as Queue<T>;
}

/**
 * Adds jobs whose id makes enqueueing idempotent. If Redis is down the rows stay
 * in their initial state in the database and the worker's sweepers pick them up
 * later, so nothing is lost; the error is logged, not thrown.
 */
async function enqueue<T>(queue: string, jobs: { id: string; data: T }[], opts: JobsOptions = {}) {
  if (jobs.length === 0) return;
  try {
    await getQueue<T>(queue).addBulk(
      jobs.map((j) => ({ name: queue, data: j.data, opts: { ...opts, jobId: j.id } })) as never,
    );
  } catch (error) {
    logger.error({ err: error, queue, count: jobs.length }, "failed to enqueue jobs; sweeper will retry");
  }
}

export async function enqueueWebhookEvents(eventIds: string[]) {
  await enqueue<WebhookJobData>(
    WEBHOOK_QUEUE,
    eventIds.map((eventId) => ({ id: eventId, data: { eventId } })),
  );
}

export async function enqueueOutboundMessages(messages: OutboundJobData[], opts: JobsOptions = {}) {
  await enqueue<OutboundJobData>(
    OUTBOUND_QUEUE,
    messages.map((data) => ({ id: data.messageId, data })),
    opts,
  );
}

export async function enqueueMediaDownloads(jobs: MediaJobData[]) {
  await enqueue<MediaJobData>(
    MEDIA_QUEUE,
    jobs.map((data) => ({ id: data.mediaObjectId, data })),
  );
}
