import crypto from "node:crypto";
import { createStreamConsumer, ensureConsumerGroup, PROGRESS_GROUP } from "../../../shared/events/bus.js";
import { processProgressEvent } from "./processProgressEvent.js";

const consumer = createStreamConsumer({
  group: PROGRESS_GROUP,
  consumer: `${process.env.CONSUMER_NAME || "progress"}-${crypto.randomUUID()}`,
  handler: processProgressEvent,
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
  await ensureConsumerGroup(PROGRESS_GROUP);
  running = true;
  poll();
};

export const stopProgressWorker = async () => {
  running = false;
  if (timer) clearImmediate(timer);
};
