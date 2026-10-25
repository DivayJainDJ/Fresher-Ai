import mongoose from "mongoose";

const testCaseSchema = new mongoose.Schema({
  input: { type: mongoose.Schema.Types.Mixed, required: true },
  expected: { type: mongoose.Schema.Types.Mixed, required: true },
}, { _id: false });
const codingProblemSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true, trim: true },
  statement: { type: String, required: true },
  referenceAnswer: { type: String, default: "", maxlength: 5000 },
  constraints: { type: [String], default: [] },
  functionName: { type: String, required: true },
  starterCode: {
    javascript: { type: String, required: true },
    python: { type: String, required: true },
  },
  visibleTests: { type: [testCaseSchema], required: true },
  hiddenTests: { type: [testCaseSchema], required: true, select: false },
  difficulty: { type: String, enum: ["easy", "medium", "hard"], required: true },
  topicTags: { type: [String], required: true },
  status: { type: String, enum: ["draft", "approved"], default: "approved", index: true },
}, { timestamps: true, versionKey: false });

export default mongoose.models.CodingProblem || mongoose.model("CodingProblem", codingProblemSchema);
