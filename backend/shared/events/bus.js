import crypto from "node:crypto";
import { z } from "zod";
import redis from "../redis/redis.js";
import { recordEventBusLag, recordJobOutcome, recordQueueDepth } from "../observability/prometheus.js";

export const EVENT_STREAM = "fresherai:events";
export const DEAD_LETTER_STREAM = "fresherai:events:dead";
export const PROGRESS_GROUP = "progress-service";
export const ROADMAP_GROUP = "roadmap-service";

const eventTypes = ["interview.completed", "behavioral.completed", "resume.scored", "quiz.completed", "sql.completed", "code.submitted", "roadmap.generated", "jd.matched", "mistake.recorded"];
const eventSchema = z.object({
  eventId: z.string().min(1).max(128),
  type: z.enum(eventTypes),
  userId: z.string().min(1).max(128),
  timestamp: z.string().datetime(),
  timezone: z.string().max(64).optional(),
  module: z.enum(["interview", "behavioral", "resume", "quiz", "sql", "coding", "roadmap"]),
  result: z.record(z.string(), z.unknown()),
}).superRefine((event, context) => {
  const expected = { "interview.completed": ["interview"], "behavioral.completed": ["behavioral"], "resume.scored": ["resume"], "quiz.completed": ["quiz"], "sql.completed": ["sql"], "code.submitted": ["coding"], "roadmap.generated": ["roadmap"], "jd.matched": ["resume"], "mistake.recorded": ["quiz", "sql", "coding"] }[event.type];
  if (!expected.includes(event.module)) context.addIssue({ code: "custom", path: ["module"], message: `Expected module ${expected.join(" or ")} for ${event.type}` });
});

const fieldsToObject = (fields) => {
  const result = {};
  for (let index = 0; index < fields.length; index += 2) result[fields[index]] = fields[index + 1];
  return result;
};

export const parseStreamEntry = ([id, fields]) => {
  const values = fieldsToObject(fields);
  return { id, event: eventSchema.parse(JSON.parse(values.event)), attempts: Number(values.attempts || 0) };
};

export const publish = async (type, payload, { client = redis } = {}) => {
  const event = eventSchema.parse({
    ...payload,
    eventId: payload.eventId || crypto.randomUUID(),
    type,
    timestamp: payload.timestamp || new Date().toISOString(),
  });
  const maxLength = Math.max(1000, Number(process.env.EVENT_STREAM_MAXLEN) || 50_000);
  const streamId = await client.xadd(EVENT_STREAM, "MAXLEN", "~", maxLength, "*", "event", JSON.stringify(event), "attempts", "0");
  return { streamId, event };
};

export const publishSafely = async (type, payload, options) => {
  const timedOut = Symbol("publish-timeout");
  let timeout;
  const operation = publish(type, payload, options).catch((error) => {
    console.error(JSON.stringify({ service: options?.service || "unknown", event: "event_publish_failed", type, requestId: options?.requestId || null, error: error.message }));
    return null;
  });
  const deadline = new Promise((resolve) => { timeout = setTimeout(() => resolve(timedOut), 500); });
  const result = await Promise.race([operation, deadline]);
  clearTimeout(timeout);
  if (result === timedOut) {
    console.error(JSON.stringify({ service: options?.service || "unknown", event: "event_publish_timeout", type, requestId: options?.requestId || null }));
    return null;
  }
  return result;
};

export const ensureConsumerGroup = async (group, { client = redis, stream = EVENT_STREAM } = {}) => {
  try { await client.xgroup("CREATE", stream, group, "0", "MKSTREAM"); }
  catch (error) { if (!String(error.message).includes("BUSYGROUP")) throw error; }
};

const toStreamFields = (fields) => {
  const normalized = fields.map((value) => value == null ? "" : String(value));
  return normalized;
};

export const createStreamConsumer = ({ group, consumer, handler, client = redis, stream = EVENT_STREAM, deadLetterStream = DEAD_LETTER_STREAM, maxAttempts = 5, blockMs = 5000 }) => {
  if (!group || !consumer || typeof handler !== "function") throw new TypeError("group, consumer, and handler are required");

  const processEntry = async (entry) => {
    const [streamId, fields] = entry;
    const values = fieldsToObject(fields);
    const attempts = Number(values.attempts || 0) + 1;
    try {
      const event = parseStreamEntry(entry).event;
      recordEventBusLag(group, event.type, (Date.now() - Date.parse(event.timestamp)) / 1000);
      await handler(event);
      await client.xack(stream, group, streamId);
      recordJobOutcome(group, "processed");
      return "processed";
    } catch (error) {
      const serializedError = String(error?.message || error).slice(0, 1000);
      const maxLength = Math.max(1000, Number(process.env.EVENT_STREAM_MAXLEN) || 50_000);
      if (attempts >= maxAttempts) {
        await client.xadd(deadLetterStream, "MAXLEN", "~", maxLength, "*", ...toStreamFields(["sourceId", streamId, "event", values.event, "attempts", attempts, "error", serializedError, "failedAt", new Date().toISOString()]));
        await client.xack(stream, group, streamId);
        recordJobOutcome(group, "dead-lettered");
        return "dead-lettered";
      }
      await client.xadd(stream, "MAXLEN", "~", maxLength, "*", ...toStreamFields(["event", values.event, "attempts", attempts, "lastError", serializedError]));
      await client.xack(stream, group, streamId);
      recordJobOutcome(group, "retried");
      return "retried";
    }
  };

  const refreshQueueDepth = async () => {
    try {
      const groups = await client.xinfo("GROUPS", stream);
      const groupValues = (groups || []).map((fields) => fieldsToObject(fields));
      const groupInfo = groupValues.find((item) => item.name === group);
      const lag = Number(groupInfo?.lag) || 0;
      const pending = Number(groupInfo?.pending) || 0;
      recordQueueDepth(group, stream, lag + pending);
    } catch {
      try {
        const pending = await client.xpending(stream, group);
        recordQueueDepth(group, stream, Number(pending?.[0]) || 0);
      } catch { /* Queue depth is best-effort instrumentation. */ }
    }
  };

  return {
    processEntry,
    async readOnce({ count = 10, block = blockMs } = {}) {
      const entries = await client.xreadgroup("GROUP", group, consumer, "COUNT", count, "BLOCK", block, "STREAMS", stream, ">");
      if (!entries) { await refreshQueueDepth(); return 0; }
      let handled = 0;
      for (const [, messages] of entries) for (const entry of messages) { await processEntry(entry); handled += 1; }
      await refreshQueueDepth();
      return handled;
    },
    async claimPending({ minIdleMs = 30_000, count = 10 } = {}) {
      const pending = await client.xpending(stream, group, "-", "+", count);
      const ids = (pending || []).filter((item) => Number(item[2]) >= minIdleMs).map((item) => item[0]);
      if (!ids.length) { await refreshQueueDepth(); return 0; }
      const claimed = await client.xclaim(stream, group, consumer, minIdleMs, ...ids);
      for (const entry of claimed || []) await processEntry(entry);
      await refreshQueueDepth();
      return claimed?.length || 0;
    },
  };
};
