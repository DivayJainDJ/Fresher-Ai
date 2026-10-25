import mongoose from "mongoose";

export const PRACTICE_TOPICS = ["quantitative", "logical", "verbal", "os", "dbms", "networks", "oop"];
const questionSchema = new mongoose.Schema({
  sourceKey: { type: String, unique: true, sparse: true, index: true },
  topic: { type: String, enum: PRACTICE_TOPICS, required: true, index: true },
  subtopic: { type: String, required: true, trim: true },
  difficulty: { type: String, enum: ["easy", "medium", "hard"], required: true, index: true },
  question: { type: String, required: true, trim: true },
  options: { type: [String], required: true, validate: (items) => items.length >= 2 && items.length <= 6 },
  correctIndex: { type: Number, required: true, min: 0, validate: { validator(value) { return value < (this.options?.length || 0); }, message: "correctIndex must reference an available option" } },
  explanation: { type: String, required: true },
  status: { type: String, enum: ["draft", "approved"], default: "draft", index: true },
}, { timestamps: true, versionKey: false });
questionSchema.index({ topic: 1, status: 1, difficulty: 1 });
export default mongoose.models.Question || mongoose.model("Question", questionSchema);
