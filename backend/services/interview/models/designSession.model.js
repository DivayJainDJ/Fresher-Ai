import mongoose from "mongoose";

const stepSchema = new mongoose.Schema({
  key: { type: String, enum: ["requirements", "entities", "api", "data-model", "scaling"], required: true },
  answer: { type: String, default: "" },
  score: { type: Number, min: 0, max: 100, default: null },
  strengths: { type: [String], default: [] },
  gaps: { type: [String], default: [] },
  modelOutline: { type: String, default: "" },
}, { _id: false });
const designSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  promptId: { type: String, required: true, index: true },
  promptTitle: { type: String, required: true },
  role: { type: String, default: "Software Engineer" },
  steps: { type: [stepSchema], default: [] },
  currentStep: { type: Number, default: 0 },
  status: { type: String, enum: ["in-progress", "completed", "failed"], default: "in-progress" },
  spendEventKey: { type: String, required: true },
}, { timestamps: true, versionKey: false });
export default mongoose.models.DesignSession || mongoose.model("DesignSession", designSessionSchema);
