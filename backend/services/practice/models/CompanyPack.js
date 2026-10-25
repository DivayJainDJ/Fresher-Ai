import mongoose from "mongoose";

const roundSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  tips: { type: [String], default: [] },
}, { _id: false });
const companyPackSchema = new mongoose.Schema({
  company: { type: String, required: true, trim: true, index: true },
  role: { type: String, required: true, trim: true, index: true },
  slug: { type: String, required: true, unique: true, index: true },
  rounds: { type: [roundSchema], required: true },
  likelyTopics: { type: [String], default: [] },
  sampleQuestions: { type: [String], default: [] },
  prepChecklist: { type: [String], default: [] },
  reviewed: { type: Boolean, default: true },
}, { timestamps: true, versionKey: false });
companyPackSchema.index({ company: 1, role: 1 }, { unique: true });
export default mongoose.models.CompanyPack || mongoose.model("CompanyPack", companyPackSchema);
