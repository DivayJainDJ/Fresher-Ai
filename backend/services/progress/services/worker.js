import crypto from "node:crypto";
import { createStreamConsumer, ensureConsumerGroup, PROGRESS_GROUP } from "../../../shared/events/bus.js";
import { processProgressEvent } from "./processProgressEvent.js";
import { processMistakeEvent } from "./processMistakeEvent.js";
import ProgressEvent from "../models/progressEvent.model.js";
import Mistake from "../models/mistake.model.js";

const consumer = createStreamConsumer({
  group: PROGRESS_GROUP,
  consumer: `${process.env.CONSUMER_NAME || "progress"}-${crypto.randomUUID()}`,
  handler: (event) => event.type === "mistake.recorded" ? processMistakeEvent(event) : processProgressEvent(event),
  maxAttempts: Number(process.env.EVENT_MAX_ATTEMPTS || 5),
});

let running = false;
let timer;

const poll = async () => {
  if (!running) return;
  try {
    await consumer.claimPending();
    await consumer.readOnce({ count: Number(process.env.EVENT_BATCH_SIZE || 25), block: 1000 });
  } catch (error) {
    console.error(JSON.stringify({ service: "progress", event: "consumer_poll_failed", error: error.message }));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (running) timer = setImmediate(poll);
};

export const startProgressWorker = async () => {
  await Promise.all([ProgressEvent.init(), Mistake.init()]);
  await ensureConsumerGroup(PROGRESS_GROUP);
  running = true;
  poll();
};

// Cloud Scheduler invokes this endpoint periodically so Redis Stream events
// continue to drain even when Cloud Run has scaled the background poller to 0.
export const drainProgressBacklog = async ({ maxBatches = 20 } = {}) => {
  let processed = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const pending = await consumer.claimPending({ count: 25 });
    const fresh = await consumer.readOnce({ count: 25, block: 100 });
    processed += pending + fresh;
    if (pending + fresh === 0) break;
  }
  return processed;
};

export const stopProgressWorker = async () => {
  running = false;
  if (timer) clearImmediate(timer);
};
