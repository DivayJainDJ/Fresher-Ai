import mongoose from "mongoose";
import ProgressEvent from "../models/progressEvent.model.js";
import UserProgress from "../models/userProgress.model.js";
import Resume from "../../resume/models/resume.model.js";
import Interview from "../../interview/models/interview.model.js";
import QuizAttempt from "../../practice/models/QuizAttempt.js";
import SqlAttempt from "../../practice/models/SqlAttempt.js";
import CodeAttempt from "../../practice/models/CodeAttempt.js";
import Roadmap from "../../roadmap/models/roadmap.model.js";
import { buildDailyPlan, buildReadinessBreakdown } from "../services/readinessDashboard.js";
import Mistake from "../models/mistake.model.js";
import User from "../../auth/model/user.model.js";
import redis from "../../../shared/redis/redis.js";
import { z } from "zod";

const average = (items) => items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : null;
const moduleMap = (modules) => modules instanceof Map ? Object.fromEntries(modules) : modules || {};
const weakTopicsFrom = (progress, events, quizAttempts) => {
  const counts = new Map();
  const add = (topic, weight = 1) => {
    if (typeof topic !== "string" || !topic.trim()) return;
    const value = topic.trim().slice(0, 100);
    counts.set(value, (counts.get(value) || 0) + weight);
  };
  (progress?.weakTopics || []).forEach((topic) => add(topic, 1));
  for (const event of events) {
    const result = event.result || {};
    for (const topic of [...(result.weakTopics || []), ...(result.weaknesses || []), ...(result.missingSkills || [])]) add(topic, 1);
    for (const [topic, stats] of Object.entries(result.perTopicAccuracy || {})) {
      if (Number.isFinite(stats?.accuracy) && stats.accuracy < 70) add(topic, 2 + (70 - stats.accuracy) / 10);
    }
  }
  for (const attempt of quizAttempts) {
    for (const [topic, stats] of Object.entries(attempt.perTopicAccuracy || {})) {
      if (Number.isFinite(stats?.accuracy) && stats.accuracy < 70) add(topic, 2 + (70 - stats.accuracy) / 10);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([topic]) => topic);
};

export const getReadinessDashboard = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!mongoose.isValidObjectId(userId)) return res.status(401).json({ success: false, message: "Unauthorized" });
    const objectId = new mongoose.Types.ObjectId(String(userId));
    const [progress, events, resume, interviews, quizzes, sql, coding, roadmaps] = await Promise.all([
      UserProgress.findOne({ userId }).lean(),
      ProgressEvent.find({ userId: objectId }).sort({ occurredAt: -1 }).limit(300).select("module score result occurredAt").lean(),
      Resume.findOne({ userId }).select("score").lean(),
      Interview.find({ userId, status: "completed" }).select("overallScore status").lean(),
      QuizAttempt.find({ userId }).sort({ submittedAt: -1 }).limit(200).select("accuracy perTopicAccuracy").lean(),
      SqlAttempt.find({ userId }).select("passed").lean(),
      CodeAttempt.find({ userId }).select("passedCount totalCount").lean(),
      Roadmap.find({ userId }).sort({ createdAt: -1 }).limit(10).select("title modules").lean(),
    ]);

    const moduleStats = moduleMap(progress?.modules);
    const interviewScore = average(interviews.filter((item) => Number.isFinite(item.overallScore)).map((item) => item.overallScore));
    const quizScore = average(quizzes.filter((item) => Number.isFinite(item.accuracy)).map((item) => item.accuracy));
    const sqlScore = sql.length ? sql.filter((item) => item.passed).length * 100 / sql.length : null;
    const codingScore = average(coding.map((item) => item.totalCount ? item.passedCount * 100 / item.totalCount : null).filter(Number.isFinite));
    const roadmapModules = roadmaps.flatMap((item) => item.modules || []);
    const roadmapScore = roadmapModules.length ? roadmapModules.filter((item) => item.practiced).length * 100 / roadmapModules.length : null;
    const signals = {
      interview: interviewScore ?? moduleStats.interview?.averageScore ?? null,
      resume: Number.isFinite(resume?.score) ? resume.score : moduleStats.resume?.averageScore ?? null,
      quiz: quizScore ?? moduleStats.quiz?.averageScore ?? null,
      sql: sqlScore ?? moduleStats.sql?.averageScore ?? null,
      coding: codingScore ?? moduleStats.coding?.averageScore ?? null,
      roadmap: roadmapScore ?? moduleStats.roadmap?.averageScore ?? null,
    };
    const readiness = buildReadinessBreakdown(signals);
    const weakTopics = weakTopicsFrom(progress, events, quizzes);
    const roadmapTasks = roadmaps.map((roadmap) => ({ ...roadmap, id: String(roadmap._id) }));
    return res.json({
      success: true,
      dashboard: {
        ...readiness,
        modules: readiness.modules.map((item) => ({ ...item, completed: moduleStats[item.module]?.completed || 0 })),
        weakTopics,
        streak: { current: progress?.currentStreak || 0, longest: progress?.longestStreak || 0 },
        dailyPlan: buildDailyPlan({ roadmaps: roadmapTasks, weakTopics }),
        empty: !readiness.hasData && !weakTopics.length && !roadmapModules.length,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ service: "progress", event: "readiness_dashboard_failed", requestId: req.headers["x-request-id"] || null, error: error.message }));
    return res.status(500).json({ success: false, message: "Unable to load readiness dashboard" });
  }
};

export const getMyProgress = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!mongoose.isValidObjectId(userId)) return res.status(401).json({ success: false, message: "Unauthorized" });
    const [progress, lag, user] = await Promise.all([
      UserProgress.findOne({ userId }).lean(),
      ProgressEvent.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
        { $group: { _id: null, processedEvents: { $sum: 1 }, averageLagMs: { $avg: "$lagMs" }, maxLagMs: { $max: "$lagMs" } } },
      ]),
      User.findById(userId).select("timezone leaderboardOptOut reminderEmailsEnabled").lean(),
    ]);
    const modules = moduleMap(progress?.modules);
    return res.json({
      success: true,
      progress: {
        modules,
        streak: { current: progress?.currentStreak || 0, longest: progress?.longestStreak || 0 },
        weakTopics: progress?.weakTopics || [],
        settings: { timezone: user?.timezone || "UTC", leaderboardOptOut: Boolean(user?.leaderboardOptOut), reminderEmailsEnabled: user?.reminderEmailsEnabled !== false },
        eventLag: lag[0] ? { processedEvents: lag[0].processedEvents, averageMs: Math.round(lag[0].averageLagMs || 0), maxMs: lag[0].maxLagMs || 0 } : { processedEvents: 0, averageMs: 0, maxMs: 0 },
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ service: "progress", event: "progress_read_failed", requestId: req.headers["x-request-id"] || null, error: error.message }));
    return res.status(500).json({ success: false, message: "Unable to load progress" });
  }
};

export const getDueMistakes = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!mongoose.isValidObjectId(userId)) return res.status(401).json({ success: false, message: "Unauthorized" });
    const mistakes = await Mistake.find({ userId, nextReviewAt: { $lte: new Date() } }).sort({ nextReviewAt: 1, createdAt: 1 }).limit(100).lean();
    return res.json({ mistakes });
  } catch { return res.status(503).json({ success: false, message: "Due cards are temporarily unavailable" }); }
};

export const reviewMistake = async (req, res) => {
  const parsed = z.object({ success: z.boolean() }).strict().safeParse(req.body);
  if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Provide a review result and valid card ID" });
  try {
    const mistake = await Mistake.findOne({ _id: req.params.id, userId: req.user?.userId, nextReviewAt: { $lte: new Date() } });
    if (!mistake) return res.status(404).json({ message: "Due card not found" });
    const intervals = [1, 3, 7, 14, 30];
    mistake.reviewCount = parsed.data.success ? Math.min(intervals.length, mistake.reviewCount + 1) : 0;
    mistake.intervalDays = parsed.data.success ? intervals[mistake.reviewCount - 1] : 1;
    mistake.lastReviewedAt = new Date();
    mistake.nextReviewAt = new Date(Date.now() + mistake.intervalDays * 24 * 60 * 60 * 1000);
    await mistake.save();
    return res.json({ mistake, nextReviewDays: mistake.intervalDays });
  } catch { return res.status(503).json({ message: "Could not save this review" }); }
};

const weekKey = (date = new Date()) => {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
};
export const getLeaderboard = async (req, res) => {
  const period = req.query.period === "all-time" ? "all-time" : req.query.period === "weekly" ? "weekly" : null;
  if (!period) return res.status(400).json({ message: "Choose weekly or all-time" });
  try {
    const key = period === "all-time" ? "leaderboard:all-time" : `leaderboard:week:${weekKey()}`;
    const rows = await redis.zrevrange(key, 0, 99, "WITHSCORES");
    const ids = [];
    for (let index = 0; index < rows.length; index += 2) ids.push(rows[index]);
    const users = await User.find({ _id: { $in: ids }, leaderboardOptOut: { $ne: true } }).select("name").lean();
    const byId = new Map(users.map((user) => [String(user._id), user.name || "FresherAI learner"]));
    const entries = [];
    for (let index = 0; index < rows.length && entries.length < 20; index += 2) {
      const name = byId.get(rows[index]);
      if (name) entries.push({ rank: entries.length + 1, displayName: name, points: Number(rows[index + 1]) });
    }
    return res.json({ period, entries });
  } catch { return res.status(503).json({ message: "Leaderboard is temporarily unavailable" }); }
};

export const updateProgressSettings = async (req, res) => {
  const parsed = z.object({ timezone: z.string().min(1).max(64).optional(), leaderboardOptOut: z.boolean().optional(), reminderEmailsEnabled: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid settings" });
  if (parsed.data.timezone) { try { new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone }); } catch { return res.status(400).json({ message: "Invalid timezone" }); } }
  try {
    const user = await User.findByIdAndUpdate(req.user?.userId, { $set: parsed.data }, { new: true }).select("timezone leaderboardOptOut reminderEmailsEnabled").lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    if (parsed.data.leaderboardOptOut === true) {
      await redis.zrem("leaderboard:all-time", String(user._id));
      const keys = await redis.keys("leaderboard:week:*");
      if (keys.length) await Promise.all(keys.map((key) => redis.zrem(key, String(user._id))));
    }
    return res.json({ settings: { timezone: user.timezone, leaderboardOptOut: user.leaderboardOptOut, reminderEmailsEnabled: user.reminderEmailsEnabled } });
  } catch { return res.status(503).json({ message: "Could not update settings" }); }
};
