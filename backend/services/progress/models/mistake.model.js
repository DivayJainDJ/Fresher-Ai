import mongoose from "mongoose";

const mistakeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  module: { type: String, enum: ["quiz", "sql", "coding"], required: true, index: true },
  topic: { type: String, required: true, maxlength: 120 },
  questionRef: { type: String, required: true, maxlength: 128 },
  question: { type: String, default: "", maxlength: 2000 },
  userAnswer: { type: String, required: true, maxlength: 12000 },
  correctAnswer: { type: String, required: true, maxlength: 12000 },
  reviewHint: { type: String, default: "", maxlength: 2000 },
  reviewCount: { type: Number, default: 0, min: 0, max: 5 },
  intervalDays: { type: Number, default: 0, min: 0, max: 30 },
  nextReviewAt: { type: Date, default: Date.now, index: true },
  lastReviewedAt: { type: Date, default: null },
  sourceEventId: { type: String, required: true, unique: true },
}, { timestamps: true, versionKey: false });
mistakeSchema.index({ userId: 1, nextReviewAt: 1 });
export default mongoose.models.Mistake || mongoose.model("Mistake", mistakeSchema);
