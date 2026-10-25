import "dotenv/config";
import mongoose from "mongoose";
import Question from "../backend/services/practice/models/Question.js";
import { approvedQuestions } from "../backend/services/practice/seeds/approvedQuestions.js";

await mongoose.connect(process.env.MONGODB_URL);
await Question.bulkWrite(approvedQuestions.map((question) => ({ updateOne: { filter: { sourceKey: question.sourceKey }, update: { $setOnInsert: question }, upsert: true } })), { ordered: false });
console.log(`Seeded ${approvedQuestions.length} approved practice questions.`);
await mongoose.disconnect();
