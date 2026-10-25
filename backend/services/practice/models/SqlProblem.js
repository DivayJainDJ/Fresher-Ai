import mongoose from "mongoose";

export const SQL_TOPICS = ["joins", "group_by", "subqueries", "window_functions"];
const resultSchema = new mongoose.Schema({
  columns: { type: [String], required: true },
  rows: { type: [[mongoose.Schema.Types.Mixed]], required: true },
}, { _id: false });

const sqlProblemSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  schemaSql: { type: String, required: true },
  seedSql: { type: String, required: true },
  expectedResult: { type: resultSchema, required: true },
  orderSensitive: { type: Boolean, default: false },
  hint: { type: String, required: true },
  difficulty: { type: String, enum: ["easy", "medium", "hard"], required: true },
  topic: { type: String, enum: SQL_TOPICS, required: true, index: true },
  status: { type: String, enum: ["draft", "approved"], default: "approved", index: true },
}, { timestamps: true, versionKey: false });

export default mongoose.models.SqlProblem || mongoose.model("SqlProblem", sqlProblemSchema);
