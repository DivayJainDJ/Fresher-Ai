import mongoose from "mongoose";

export const BEHAVIORAL_CATEGORIES = ["introduction", "teamwork", "conflict", "failure", "leadership", "salary"];

const behavioralQuestionSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true },
  category: { type: String, enum: BEHAVIORAL_CATEGORIES, required: true, index: true },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true, versionKey: false });
behavioralQuestionSchema.index({ category: 1, active: 1 });

export default mongoose.models.BehavioralQuestion || mongoose.model("BehavioralQuestion", behavioralQuestionSchema);
