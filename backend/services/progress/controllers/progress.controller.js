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
    const [progress, lag] = await Promise.all([
      UserProgress.findOne({ userId }).lean(),
      ProgressEvent.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
        { $group: { _id: null, processedEvents: { $sum: 1 }, averageLagMs: { $avg: "$lagMs" }, maxLagMs: { $max: "$lagMs" } } },
      ]),
    ]);
    const modules = moduleMap(progress?.modules);
    return res.json({
      success: true,
      progress: {
        modules,
        streak: { current: progress?.currentStreak || 0, longest: progress?.longestStreak || 0 },
        weakTopics: progress?.weakTopics || [],
        eventLag: lag[0] ? { processedEvents: lag[0].processedEvents, averageMs: Math.round(lag[0].averageLagMs || 0), maxMs: lag[0].maxLagMs || 0 } : { processedEvents: 0, averageMs: 0, maxMs: 0 },
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ service: "progress", event: "progress_read_failed", requestId: req.headers["x-request-id"] || null, error: error.message }));
    return res.status(500).json({ success: false, message: "Unable to load progress" });
  }
};
