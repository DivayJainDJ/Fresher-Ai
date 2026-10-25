import mongoose from "mongoose";
import ProgressEvent from "../models/progressEvent.model.js";
import UserProgress from "../models/userProgress.model.js";

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
    const modules = progress?.modules instanceof Map ? Object.fromEntries(progress.modules) : progress?.modules || {};
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
