/**
 * Background worker. Run with `npm run worker` (separate process from the web app).
 * Phase 3: processes stored Meta webhook events. Campaign sending joins in Phase 5.
 */
import "./env";
import { Worker } from "bullmq";
import { logger } from "@/server/logging/logger";
import { createQueueConnection, queuePrefix } from "@/server/queue/connection";
import { enqueueWebhookEvents, WEBHOOK_QUEUE, type WebhookJobData } from "@/server/queue/queues";
import { findUnprocessedEvents, processWebhookEvent } from "@/server/webhooks/meta-processor";

const log = logger;

const webhookWorker = new Worker<WebhookJobData>(
  WEBHOOK_QUEUE,
  async (job) => {
    const status = await processWebhookEvent(job.data.eventId);
    log.info({ jobId: job.id, eventId: job.data.eventId, status }, "webhook event processed");
    return status;
  },
  { connection: createQueueConnection(), prefix: queuePrefix(), concurrency: 10 },
);

webhookWorker.on("failed", (job, err) =>
  log.warn({ jobId: job?.id, attempts: job?.attemptsMade, err }, "webhook job failed"),
);

// Sweeper: re-enqueue events stored while Redis was unavailable.
const sweep = async () => {
  try {
    const ids = await findUnprocessedEvents();
    if (ids.length > 0) {
      log.info({ count: ids.length }, "re-enqueueing unprocessed webhook events");
      await enqueueWebhookEvents(ids);
    }
  } catch (err) {
    log.error({ err }, "sweeper failed");
  }
};
const sweepTimer = setInterval(sweep, 60_000);
void sweep();

log.info("worker started");

async function shutdown(signal: string) {
  log.info({ signal }, "worker shutting down");
  clearInterval(sweepTimer);
  await webhookWorker.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
