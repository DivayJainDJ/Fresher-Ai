import mongoose from "mongoose";

const reminderDeliverySchema = new mongoose.Schema({
  applicationId: { type: mongoose.Schema.Types.ObjectId, required: true },
  dueDate: { type: String, required: true },
  status: { type: String, enum: ["sending", "sent", "failed"], required: true },
  providerId: { type: String, default: "" },
  error: { type: String, default: "" },
  sentAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });
reminderDeliverySchema.index({ applicationId: 1, dueDate: 1 }, { unique: true });
export default mongoose.models.ReminderDelivery || mongoose.model("ReminderDelivery", reminderDeliverySchema);
