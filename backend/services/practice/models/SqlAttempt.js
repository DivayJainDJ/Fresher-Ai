import mongoose from "mongoose";

const sqlAttemptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  problemId: { type: mongoose.Schema.Types.ObjectId, ref: "SqlProblem", required: true, index: true },
  passed: { type: Boolean, required: true },
  attemptMs: { type: Number, required: true, min: 0, max: 3_600_000 },
  submittedAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

export default mongoose.models.SqlAttempt || mongoose.model("SqlAttempt", sqlAttemptSchema);
