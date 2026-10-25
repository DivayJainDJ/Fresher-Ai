import mongoose from "mongoose";
import { z } from "zod";
import ProgressEvent from "../models/progressEvent.model.js";
import Mistake from "../models/mistake.model.js";

const mistakeEventSchema = z.object({
  eventId: z.string().min(1).max(128), type: z.literal("mistake.recorded"), userId: z.string().min(1),
  timestamp: z.string().datetime(), module: z.enum(["quiz", "sql", "coding"]),
  result: z.object({ mistakes: z.array(z.object({
    topic: z.string().min(1).max(120), questionRef: z.string().min(1).max(128), question: z.string().max(2000).default(""),
    userAnswer: z.string().max(12000), correctAnswer: z.string().max(12000), reviewHint: z.string().max(2000).default(""),
  }).strict()).min(1).max(40) }).strict(),
}).strict();

export const processMistakeEvent = async (rawEvent, { EventModel = ProgressEvent, MistakeModel = Mistake, sessionFactory = () => mongoose.startSession(), now = () => new Date() } = {}) => {
  const event = mistakeEventSchema.parse(rawEvent);
  if (!mongoose.isValidObjectId(event.userId)) throw new TypeError("Mistake event userId must be a Mongo ObjectId");
  const session = await sessionFactory();
  try {
    await session.withTransaction(async () => {
      const existing = await EventModel.findOne({ eventId: event.eventId }).session(session);
      if (existing) return;
      const when = now();
      await MistakeModel.insertMany(event.result.mistakes.map((item, index) => ({
        userId: event.userId, module: event.module, ...item, sourceEventId: `${event.eventId}:${index}`,
        nextReviewAt: when,
      })), { session, ordered: true });
      await EventModel.create([{ eventId: event.eventId, type: event.type, userId: event.userId, occurredAt: new Date(event.timestamp), processedAt: when, lagMs: Math.max(0, when.getTime() - Date.parse(event.timestamp)), module: event.module, result: { mistakesCreated: event.result.mistakes.length } }], { session });
    });
  } finally { await session.endSession(); }
};
