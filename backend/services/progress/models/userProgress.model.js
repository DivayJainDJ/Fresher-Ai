import mongoose from "mongoose";

const moduleStatsSchema = new mongoose.Schema({
  completed: { type: Number, default: 0, min: 0 },
  scoreCount: { type: Number, default: 0, min: 0 },
  scoreTotal: { type: Number, default: 0 },
  averageScore: { type: Number, default: null },
  lastActivityAt: { type: Date, default: null },
}, { _id: false });

const userProgressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
  modules: { type: Map, of: moduleStatsSchema, default: {} },
  currentStreak: { type: Number, default: 0, min: 0 },
  longestStreak: { type: Number, default: 0, min: 0 },
  lastActivityDate: { type: String, default: null },
  timezone: { type: String, default: "UTC" },
  weakTopics: { type: [String], default: [] },
  lastEventAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

export default mongoose.model("UserProgress", userProgressSchema);
