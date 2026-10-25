import mongoose from "mongoose";
import { z } from "zod";
import ProgressEvent from "../models/progressEvent.model.js";
import UserProgress from "../models/userProgress.model.js";
import { eventModule } from "../../../shared/events/module.js";
import redis from "../../../shared/redis/redis.js";
import User from "../../auth/model/user.model.js";

const progressEventSchema = z.object({
  eventId: z.string().min(1),
  type: z.enum(Object.keys(eventModule)),
  userId: z.string().min(1),
  timestamp: z.string().datetime(),
  timezone: z.string().max(64).optional(),
  module: z.enum(["interview", "behavioral", "resume", "quiz", "sql", "coding", "roadmap"]),
  result: z.record(z.string(), z.unknown()),
});

const dayKey = (date, timezone = "UTC") => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
  catch { return date.toISOString().slice(0, 10); }
};
const clampScore = (score) => Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : undefined;
const extractWeakTopics = (result) => {
  const values = [result.weakTopics, result.weaknesses, result.missingSkills]
    .flatMap((item) => Array.isArray(item) ? item : [])
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().slice(0, 100))
    .filter(Boolean);
  return [...new Set(values)].slice(0, 30);
};

export const processProgressEvent = async (rawEvent, { EventModel = ProgressEvent, ProgressModel = UserProgress, sessionFactory = () => mongoose.startSession(), now = () => new Date(), redisClient = redis } = {}) => {
  const event = progressEventSchema.parse(rawEvent);
  if (!mongoose.isValidObjectId(event.userId)) throw new TypeError("Progress event userId must be a Mongo ObjectId");
  const occurredAt = new Date(event.timestamp);
  let processedAt;
  let lagMs = 0;
  const score = clampScore(event.result.score ?? event.result.overallScore);
  const topics = extractWeakTopics(event.result);
  const session = await sessionFactory();
  let activityTimezone = event.timezone || "UTC";
  let result = { duplicate: false, lagMs };

  try {
    await session.withTransaction(async () => {
      const existing = await EventModel.findOne({ eventId: event.eventId }).session(session);
      if (existing) { result = { duplicate: true, lagMs: existing.lagMs }; return; }

      const previous = await ProgressModel.findOne({ userId: event.userId }).session(session).lean();
      const previousDay = previous?.lastActivityDate;
      const timezone = event.timezone || previous?.timezone || "UTC";
      activityTimezone = timezone;
      const today = dayKey(occurredAt, timezone);
      const redisActivityDay = await redisClient.get(`progress:activity-day:${event.userId}`).catch(() => null);
      const yesterdayDate = new Date(`${today}T00:00:00.000Z`);
      yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
      const yesterday = dayKey(yesterdayDate);
      const isNewDay = previousDay !== today && redisActivityDay !== today;
      const currentStreak = !isNewDay ? previous?.currentStreak || 1 : previousDay === yesterday ? (previous?.currentStreak || 0) + 1 : 1;
      const module = event.module;
      const update = {
        $inc: { [`modules.${module}.completed`]: 1, ...(score === undefined ? {} : { [`modules.${module}.scoreCount`]: 1, [`modules.${module}.scoreTotal`]: score }) },
        $max: { lastEventAt: occurredAt, [`modules.${module}.lastActivityAt`]: occurredAt, longestStreak: currentStreak },
        $set: { lastActivityDate: today, timezone, currentStreak },
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
    if (!result.duplicate) {
      await redisClient.set(`progress:activity-day:${event.userId}`, dayKey(occurredAt, activityTimezone), "EX", 60 * 24 * 60 * 60).catch(() => {});
    }
    if (!result.duplicate && ["quiz.completed", "sql.completed"].includes(event.type)) {
      try {
        const user = await User.findById(event.userId).select("leaderboardOptOut").lean();
        const points = Math.max(0, Number(event.result.score) || 0);
        if (user && !user.leaderboardOptOut && points > 0) {
          const date = occurredAt.toISOString().slice(0, 10);
          const weekStart = new Date(`${date}T00:00:00.000Z`);
          weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
          const weekKey = weekStart.toISOString().slice(0, 10);
          await redisClient.zincrby("leaderboard:all-time", points, String(event.userId));
          await redisClient.zincrby(`leaderboard:week:${weekKey}`, points, String(event.userId));
          await redisClient.expire(`leaderboard:week:${weekKey}`, 8 * 24 * 60 * 60);
        }
      } catch (error) { console.error(JSON.stringify({ service: "progress", event: "leaderboard_update_failed", error: error.message })); }
    }
    return result;
  } finally {
    await session.endSession();
  }
};
