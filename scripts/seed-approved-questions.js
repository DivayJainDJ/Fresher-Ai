import "dotenv/config";
import mongoose from "mongoose";
import Question from "../backend/services/practice/models/Question.js";
import { approvedQuestions } from "../backend/services/practice/seeds/approvedQuestions.js";
import SqlProblem from "../backend/services/practice/models/SqlProblem.js";
import { sqlProblems } from "../backend/services/practice/seeds/sqlProblems.js";
import CodingProblem from "../backend/services/practice/models/CodingProblem.js";
import { codingProblems } from "../backend/services/practice/seeds/codingProblems.js";

await mongoose.connect(process.env.MONGODB_URL);
await Question.bulkWrite(approvedQuestions.map((question) => ({ updateOne: { filter: { sourceKey: question.sourceKey }, update: { $setOnInsert: question }, upsert: true } })), { ordered: false });
await SqlProblem.bulkWrite(sqlProblems.map((problem) => ({ updateOne: { filter: { slug: problem.slug }, update: { $setOnInsert: problem }, upsert: true } })), { ordered: false });
await CodingProblem.bulkWrite(codingProblems.map((problem) => ({ updateOne: { filter: { slug: problem.slug }, update: { $setOnInsert: problem }, upsert: true } })), { ordered: false });
console.log(`Seeded ${approvedQuestions.length} approved quiz questions, ${sqlProblems.length} SQL problems, and ${codingProblems.length} coding problems.`);
await mongoose.disconnect();
