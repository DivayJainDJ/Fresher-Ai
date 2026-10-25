import mongoose from "mongoose";

const codeAttemptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  problemId: { type: mongoose.Schema.Types.ObjectId, ref: "CodingProblem", required: true, index: true },
  language: { type: String, enum: ["javascript", "python"], required: true },
  passedCount: { type: Number, required: true, min: 0 },
  totalCount: { type: Number, required: true, min: 1 },
  runtimeMs: { type: Number, required: true, min: 0, max: 30_000 },
  submittedAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

export default mongoose.models.CodeAttempt || mongoose.model("CodeAttempt", codeAttemptSchema);
