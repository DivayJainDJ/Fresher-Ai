import "dotenv/config";
import mongoose from "mongoose";
import Question from "../backend/services/practice/models/Question.js";

const args = process.argv.slice(2);
const approveAll = args[0] === "--all";
const ids = approveAll ? [] : args.filter((arg) => !arg.startsWith("--"));
if (!approveAll && ids.length === 0) throw new Error("Usage: node backend/scripts/approve-questions.js <id...> | --all [--topic=topic]");
const topicArg = args.find((arg) => arg.startsWith("--topic="));
const filter = { status: "draft", ...(approveAll ? {} : { _id: { $in: ids } }), ...(topicArg ? { topic: topicArg.slice(8) } : {}) };
await mongoose.connect(process.env.MONGODB_URL);
const result = await Question.updateMany(filter, { $set: { status: "approved" } });
console.log(`Approved ${result.modifiedCount} draft questions.`);
await mongoose.disconnect();
