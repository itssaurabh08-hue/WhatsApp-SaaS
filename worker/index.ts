/**
 * Background worker. Run with `npm run worker` (separate process from the web app).
 * Queues: Meta webhook events, outbound messages, incoming media downloads.
 * Sweepers recover work stored while Redis was unavailable.
 */
import "./env";
import { createServer } from "node:http";
import { Worker, type Job } from "bullmq";
import { logger } from "@/server/logging/logger";
import { downloadInboundMedia } from "@/server/messaging/media";
import { deliverMessage, reconcileOutbound } from "@/server/messaging/outbound";
import { createQueueConnection, queuePrefix } from "@/server/queue/connection";
import { validateStartup } from "@/server/startup";
import {
  enqueueWebhookEvents,
  MEDIA_QUEUE,
  OUTBOUND_QUEUE,
  WEBHOOK_QUEUE,
  type MediaJobData,
  type OutboundJobData,
  type WebhookJobData,
} from "@/server/queue/queues";
import { findDeferredEvents, findUnprocessedEvents, processWebhookEvent } from "@/server/webhooks/meta-processor";

const log = logger;
validateStartup();
const base = () => ({ connection: createQueueConnection(), prefix: queuePrefix() });
const isFinalAttempt = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

const workers = [
  new Worker<WebhookJobData>(
    WEBHOOK_QUEUE,
    async (job) => {
      const status = await processWebhookEvent(job.data.eventId);
      log.info({ jobId: job.id, status }, "webhook event processed");
      return status;
    },
    { ...base(), concurrency: 10 },
  ),
  new Worker<OutboundJobData>(
    OUTBOUND_QUEUE,
    async (job) => {
      const outcome = await deliverMessage(job.data.messageId, { finalAttempt: isFinalAttempt(job) });
      log.info({ jobId: job.id, outcome }, "outbound message processed");
      return outcome;
    },
    { ...base(), concurrency: 20 },
  ),
  new Worker<MediaJobData>(
    MEDIA_QUEUE,
    async (job) => downloadInboundMedia({ ...job.data, finalAttempt: isFinalAttempt(job) }),
    { ...base(), concurrency: 5 },
  ),
];

for (const w of workers) {
  w.on("failed", (job, err) =>
    log.warn({ queue: w.name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, "job failed"),
  );
}

let sweeping = false;
const sweep = async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    const ids = await findUnprocessedEvents();
    if (ids.length > 0) {
      log.info({ count: ids.length }, "re-enqueueing unprocessed webhook events");
      await enqueueWebhookEvents(ids);
    }
    // Events stored before their handler existed are replayed in arrival order.
    for (const id of await findDeferredEvents()) {
      await processWebhookEvent(id).catch((err: unknown) => log.warn({ err, id }, "deferred replay failed"));
    }
    const outbound = await reconcileOutbound();
    if (outbound.requeued || outbound.failed) log.info(outbound, "outbound reconciliation");
  } catch (err) {
    log.error({ err }, "sweeper failed");
  } finally {
    sweeping = false;
  }
};
const sweepTimer = setInterval(sweep, 60_000);
void sweep();

// Optional health endpoint for container orchestration and end-to-end tests.
const healthPort = Number(process.env.WORKER_HEALTH_PORT || 0);
const health = healthPort
  ? createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    }).listen(healthPort, "127.0.0.1")
  : null;

log.info("worker started");

async function shutdown(signal: string) {
  log.info({ signal }, "worker shutting down");
  clearInterval(sweepTimer);
  health?.close();
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
