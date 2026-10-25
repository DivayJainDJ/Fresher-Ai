import mongoose from "mongoose";

const dailyChallengeAttemptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  date: { type: String, required: true },
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  selectedIndex: { type: Number, default: null },
  correct: { type: Boolean, required: true },
}, { timestamps: true, versionKey: false });
dailyChallengeAttemptSchema.index({ userId: 1, date: 1 }, { unique: true });
export default mongoose.models.DailyChallengeAttempt || mongoose.model("DailyChallengeAttempt", dailyChallengeAttemptSchema);
