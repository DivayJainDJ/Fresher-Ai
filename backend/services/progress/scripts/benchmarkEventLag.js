import dotenv from "dotenv";
dotenv.config();
import crypto from "node:crypto";
import mongoose from "mongoose";
import redis from "../../../shared/redis/redis.js";
import { EVENT_STREAM, publish } from "../../../shared/events/bus.js";
import { connectDB } from "../config/db.js";
import ProgressEvent from "../models/progressEvent.model.js";
import UserProgress from "../models/userProgress.model.js";

const numberArg = (name, fallback) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=")[1];
  return value === undefined ? fallback : Number(value);
};
const count = numberArg("count", 1000);
const targetRate = numberArg("rate", 100);
if (!Number.isInteger(count) || count < 1 || count > 20_000 || !Number.isFinite(targetRate) || targetRate < 1 || targetRate > 10_000) {
  throw new RangeError("Use --count=1..20000 and --rate=1..10000");
}

const userId = new mongoose.Types.ObjectId();
const prefix = `lag-benchmark:${crypto.randomUUID()}`;
const eventIds = [];
const streamIds = [];
const percentile = (values, fraction) => values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];

try {
  await connectDB();
  const startedAt = Date.now();
  for (let index = 0; index < count; index += 1) {
    const targetAt = startedAt + Math.floor(index * 1000 / targetRate);
    const delay = targetAt - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const eventId = `${prefix}:${index}`;
    eventIds.push(eventId);
    const published = await publish("quiz.completed", {
      eventId,
      userId: userId.toString(),
      module: "quiz",
      result: { score: index % 101, benchmark: true },
    });
    streamIds.push(published.streamId);
  }
  const publishFinishedAt = Date.now();

  const deadline = Date.now() + 120_000;
  let processed = [];
  while (processed.length < count && Date.now() < deadline) {
    processed = await ProgressEvent.find({ eventId: { $in: eventIds } }).select("lagMs").lean();
    if (processed.length < count) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (processed.length !== count) throw new Error(`Timed out waiting for progress consumer: ${processed.length}/${count} processed`);
  const publishDurationMs = Math.max(1, publishFinishedAt - startedAt);
  const lags = processed.map((item) => item.lagMs).sort((left, right) => left - right);
  process.stdout.write(`${JSON.stringify({ count, targetRatePerSecond: targetRate, publishRatePerSecond: Number((count / (publishDurationMs / 1000)).toFixed(2)), averageLagMs: Math.round(lags.reduce((sum, value) => sum + value, 0) / count), p50LagMs: percentile(lags, 0.5), p95LagMs: percentile(lags, 0.95), maxLagMs: lags.at(-1) }, null, 2)}\n`);
} finally {
  if (eventIds.length) await ProgressEvent.deleteMany({ eventId: { $in: eventIds } }).catch(() => {});
  await UserProgress.deleteOne({ userId }).catch(() => {});
  if (streamIds.length) await redis.xdel(EVENT_STREAM, ...streamIds).catch(() => {});
  await redis.quit().catch(() => {});
  await mongoose.disconnect().catch(() => {});
}
