import mongoose from "mongoose";

const progressEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  type: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  occurredAt: { type: Date, required: true, index: true },
  processedAt: { type: Date, required: true },
  lagMs: { type: Number, required: true, min: 0 },
  module: { type: String, required: true },
  score: { type: Number },
  result: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, versionKey: false });

progressEventSchema.index({ userId: 1, occurredAt: -1 });
export default mongoose.model("ProgressEvent", progressEventSchema);
