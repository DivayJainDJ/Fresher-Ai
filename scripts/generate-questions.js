import "dotenv/config";
import mongoose from "mongoose";
import { z } from "zod";
import Question, { PRACTICE_TOPICS } from "../backend/services/practice/models/Question.js";

const topic = process.argv[2];
const count = Math.min(50, Math.max(1, Number(process.argv[3] || 10)));
if (!PRACTICE_TOPICS.includes(topic)) throw new Error(`Usage: node backend/scripts/generate-questions.js <${PRACTICE_TOPICS.join("|")}> [count]`);
if (!process.env.GROQ_API_KEY) throw new Error("Set GROQ_API_KEY to run the offline question generator.");

const generatedSchema = z.array(z.object({
  subtopic: z.string().min(2).max(80), difficulty: z.enum(["easy", "medium", "hard"]),
  question: z.string().min(10).max(500), options: z.array(z.string().min(1).max(200)).length(4),
  correctIndex: z.number().int().min(0).max(3), explanation: z.string().min(5).max(500),
}).strict()).length(count);

const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST", headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile", temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Write original, accurate multiple-choice practice questions. Return only JSON in shape {\"questions\":[...]}. Each question has subtopic, difficulty (easy|medium|hard), question, exactly four options, correctIndex (zero-based), and a short explanation. Do not copy published questions." },
      { role: "user", content: `Create exactly ${count} distinct ${topic} questions for Indian fresher job preparation. Vary subtopics and difficulty. Return no markdown.` },
    ],
  }),
});
if (!response.ok) throw new Error(`Groq generation failed (${response.status}): ${(await response.text()).slice(0, 400)}`);
const payload = await response.json();
const parsed = generatedSchema.parse(JSON.parse(payload.choices?.[0]?.message?.content || "{}").questions);
await mongoose.connect(process.env.MONGODB_URL);
const docs = parsed.map((question) => ({ ...question, topic, status: "draft" }));
const inserted = await Question.insertMany(docs);
console.log(`Saved ${inserted.length} ${topic} draft questions. Review and approve them with backend/scripts/approve-questions.js.`);
await mongoose.disconnect();
