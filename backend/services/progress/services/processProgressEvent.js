import mongoose from "mongoose";
import { z } from "zod";
import ProgressEvent from "../models/progressEvent.model.js";
import UserProgress from "../models/userProgress.model.js";
import { eventModule } from "../../../shared/events/module.js";

const progressEventSchema = z.object({
  eventId: z.string().min(1),
  type: z.enum(Object.keys(eventModule)),
  userId: z.string().min(1),
  timestamp: z.string().datetime(),
  module: z.enum(["interview", "resume", "quiz", "sql", "coding", "roadmap"]),
  result: z.record(z.string(), z.unknown()),
});

const dayKey = (date) => date.toISOString().slice(0, 10);
const clampScore = (score) => Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : undefined;
const extractWeakTopics = (result) => {
  const values = [result.weakTopics, result.weaknesses, result.missingSkills]
    .flatMap((item) => Array.isArray(item) ? item : [])
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().slice(0, 100))
    .filter(Boolean);
  return [...new Set(values)].slice(0, 30);
};

export const processProgressEvent = async (rawEvent, { EventModel = ProgressEvent, ProgressModel = UserProgress, sessionFactory = () => mongoose.startSession(), now = () => new Date() } = {}) => {
  const event = progressEventSchema.parse(rawEvent);
  if (!mongoose.isValidObjectId(event.userId)) throw new TypeError("Progress event userId must be a Mongo ObjectId");
  const occurredAt = new Date(event.timestamp);
  let processedAt;
  let lagMs = 0;
  const score = clampScore(event.result.score ?? event.result.overallScore);
  const topics = extractWeakTopics(event.result);
  const session = await sessionFactory();
  let result = { duplicate: false, lagMs };

  try {
    await session.withTransaction(async () => {
      const existing = await EventModel.findOne({ eventId: event.eventId }).session(session);
      if (existing) { result = { duplicate: true, lagMs: existing.lagMs }; return; }

      const previous = await ProgressModel.findOne({ userId: event.userId }).session(session).lean();
      const previousDay = previous?.lastActivityDate;
      const today = dayKey(occurredAt);
      const yesterdayDate = new Date(`${today}T00:00:00.000Z`);
      yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
      const yesterday = dayKey(yesterdayDate);
      const isNewDay = previousDay !== today;
      const currentStreak = !isNewDay ? previous?.currentStreak || 1 : previousDay === yesterday ? (previous?.currentStreak || 0) + 1 : 1;
      const module = event.module;
      const update = {
        $inc: { [`modules.${module}.completed`]: 1, ...(score === undefined ? {} : { [`modules.${module}.scoreCount`]: 1, [`modules.${module}.scoreTotal`]: score }) },
        $max: { lastEventAt: occurredAt, [`modules.${module}.lastActivityAt`]: occurredAt, longestStreak: currentStreak },
        $set: { lastActivityDate: isNewDay ? today : previousDay, currentStreak },
        ...(topics.length ? { $addToSet: { weakTopics: { $each: topics } } } : {}),
      };
      const progress = await ProgressModel.findOneAndUpdate({ userId: event.userId }, update, { new: true, upsert: true, session, setDefaultsOnInsert: true });
      if (score !== undefined) {
        const stats = progress.modules instanceof Map ? progress.modules.get(module) : progress.modules?.[module];
        if (stats) stats.averageScore = (stats.scoreTotal || score) / (stats.scoreCount || 1);
        await progress.save({ session });
      }
      processedAt = now();
      lagMs = Math.max(0, processedAt.getTime() - occurredAt.getTime());
      result = { duplicate: false, lagMs };
      await EventModel.create([{
        eventId: event.eventId,
        type: event.type,
        userId: event.userId,
        occurredAt,
        processedAt,
        lagMs,
        module,
        ...(score === undefined ? {} : { score }),
        result: event.result,
      }], { session });
    });
    return result;
  } finally {
    await session.endSession();
  }
};
