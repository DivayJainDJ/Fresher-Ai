import crypto from "node:crypto";
import { createStreamConsumer, ensureConsumerGroup, ROADMAP_GROUP } from "../../../shared/events/bus.js";
import Roadmap from "../models/roadmap.model.js";

const topicTokens = (value) => new Set(String(value).toLowerCase().split(/[^a-z0-9+#.]+/).filter((token) => token.length > 2));

export const markInterviewTopicsPracticed = async (RoadmapModel, event) => {
  if (event.type !== "interview.completed") return;
  const weakTopics = Array.isArray(event.result.weakTopics) ? event.result.weakTopics.filter((topic) => typeof topic === "string") : [];
  const roadmaps = await RoadmapModel.find({ userId: event.userId });
  const roleTokens = topicTokens(event.result.role || "");
  for (const roadmap of roadmaps) {
    const roadmapTokens = topicTokens(roadmap.title);
    const isRelatedRoadmap = roleTokens.size > 0 && [...roleTokens].some((token) => roadmapTokens.has(token));
    const matched = (roadmap.modules || []).filter((module) => {
      const title = String(module.title || "");
      const titleTokens = topicTokens(title);
      return weakTopics.some((topic) => {
        const weakTokens = topicTokens(topic);
        const overlap = [...titleTokens].filter((token) => weakTokens.has(token)).length;
        return title.toLowerCase() === topic.toLowerCase() || (titleTokens.size > 0 && overlap / titleTokens.size >= 0.5);
      }) || (weakTopics.length === 0 && isRelatedRoadmap);
    });
    if (!matched.length) continue;
    const names = matched.map((module) => module.title);
    await RoadmapModel.updateOne(
      { _id: roadmap._id },
      {
        $addToSet: { practicedTopics: { $each: names } },
        $set: { "modules.$[module].practiced": true, "modules.$[module].practicedAt": new Date(event.timestamp) },
      },
      { arrayFilters: [{ "module.title": { $in: names } }] },
    );
  }
};

const handler = async (event) => markInterviewTopicsPracticed(Roadmap, event);

const consumer = createStreamConsumer({
  group: ROADMAP_GROUP,
  consumer: `${process.env.ROADMAP_CONSUMER_NAME || "roadmap"}-${crypto.randomUUID()}`,
  handler,
  maxAttempts: Number(process.env.EVENT_MAX_ATTEMPTS || 5),
});

let running = false;
let timer;
const poll = async () => {
  if (!running) return;
  try { await consumer.claimPending(); await consumer.readOnce({ count: 25, block: 1000 }); }
  catch (error) {
    console.error(JSON.stringify({ service: "roadmap", event: "event_consumer_poll_failed", error: error.message }));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (running) timer = setImmediate(poll);
};

export const startInterviewEventWorker = async () => {
  await ensureConsumerGroup(ROADMAP_GROUP);
  running = true;
  poll();
};

// Scheduler-triggered drain keeps this consumer useful when its Cloud Run
// instance is otherwise allowed to scale to zero.
export const drainRoadmapBacklog = async ({ maxBatches = 20 } = {}) => {
  let processed = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const pending = await consumer.claimPending({ count: 25 });
    const fresh = await consumer.readOnce({ count: 25, block: 100 });
    processed += pending + fresh;
    if (pending + fresh === 0) break;
  }
  return processed;
};

export const stopInterviewEventWorker = async () => {
  running = false;
  if (timer) clearImmediate(timer);
};
