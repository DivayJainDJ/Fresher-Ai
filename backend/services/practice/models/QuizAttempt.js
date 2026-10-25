import mongoose from "mongoose";

const quizAttemptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  idempotencyKey: { type: String, required: true },
  quizId: { type: String, required: true },
  topic: { type: String, required: true },
  score: { type: Number, required: true },
  total: { type: Number, required: true },
  accuracy: { type: Number, required: true },
  perTopicAccuracy: { type: mongoose.Schema.Types.Mixed, default: {} },
  answers: { type: [mongoose.Schema.Types.Mixed], default: [] },
  submittedAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });
quizAttemptSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
export default mongoose.models.QuizAttempt || mongoose.model("QuizAttempt", quizAttemptSchema);
