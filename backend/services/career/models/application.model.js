import mongoose from "mongoose";

const applicationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  company: { type: String, required: true, trim: true, maxlength: 120 },
  role: { type: String, required: true, trim: true, maxlength: 160 },
  link: { type: String, trim: true, maxlength: 2000, default: "" },
  stage: { type: String, enum: ["wishlist", "applied", "oa", "interview", "offer", "rejected"], default: "wishlist", index: true },
  notes: { type: String, trim: true, maxlength: 5000, default: "" },
  nextActionDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: "" },
  reminderSentForDate: { type: String, default: "" },
}, { timestamps: true, versionKey: false });
applicationSchema.index({ userId:  1, nextActionDate: 1, stage: 1 });
export default mongoose.models.Application || mongoose.model("Application", applicationSchema);
