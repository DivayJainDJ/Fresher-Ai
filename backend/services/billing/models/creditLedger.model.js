import mongoose from "mongoose";

const creditLedgerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  amount: { type: Number, required: true },
  type: { type: String, enum: ["purchase", "signup", "opening", "spend", "refund"], required: true },
  action: { type: String },
  eventKey: { type: String },
  billingId: { type: mongoose.Schema.Types.ObjectId, ref: "Billing" },
  razorpayPaymentId: { type: String },
}, { timestamps: true, versionKey: false });

creditLedgerSchema.index({ billingId: 1 }, { unique: true, partialFilterExpression: { billingId: { $exists: true } } });
creditLedgerSchema.index({ eventKey: 1 }, { unique: true, partialFilterExpression: { eventKey: { $exists: true } } });

export default mongoose.model("CreditLedger", creditLedgerSchema);
