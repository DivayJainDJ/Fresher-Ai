import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import { connectDB } from "./config/db.js";
import { dependencyHealth } from "../../shared/utils/health.js";
import { requestLogger } from "../../shared/middleware/requestLogger.js";
import { installPrometheusMetrics } from "../../shared/observability/prometheus.js";
import practiceRouter from "./routes/practice.route.js";
import Question from "./models/Question.js";
import QuizAttempt from "./models/QuizAttempt.js";
import SqlProblem from "./models/SqlProblem.js";
import SqlAttempt from "./models/SqlAttempt.js";
import { approvedQuestions } from "./seeds/approvedQuestions.js";
import { sqlProblems } from "./seeds/sqlProblems.js";
import CodingProblem from "./models/CodingProblem.js";
import CodeAttempt from "./models/CodeAttempt.js";
import { codingProblems } from "./seeds/codingProblems.js";
import CompanyPack from "./models/CompanyPack.js";
import { companyPacks } from "./seeds/companyPacks.js";
import DailyChallengeAttempt from "./models/DailyChallengeAttempt.js";

const app = express();
app.use((req, res, next) => {
  req.requestId = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
});
app.use(requestLogger("practice"));
installPrometheusMetrics(app, "practice");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.get("/health", (_req, res) => dependencyHealth("practice", res));
app.use("/", practiceRouter);

const seedQuestionBank = async () => {
  await Question.bulkWrite(approvedQuestions.map((question) => ({
    updateOne: { filter: { sourceKey: question.sourceKey }, update: { $setOnInsert: question }, upsert: true },
  })), { ordered: false });
  console.log(`Practice question bank ready (${approvedQuestions.length} bundled questions)`);
};

const seedSqlProblems = async () => {
  await SqlProblem.bulkWrite(sqlProblems.map((problem) => ({
    updateOne: { filter: { slug: problem.slug }, update: { $setOnInsert: problem }, upsert: true },
  })), { ordered: false });
  console.log(`SQL problem bank ready (${sqlProblems.length} bundled problems)`);
};

const seedCodingProblems = async () => {
  await CodingProblem.bulkWrite(codingProblems.map((problem) => {
    const { referenceAnswer, ...insertOnly } = problem;
    return { updateOne: { filter: { slug: problem.slug }, update: { $setOnInsert: insertOnly, $set: { referenceAnswer } }, upsert: true } };
  }), { ordered: false });
  console.log(`Coding problem bank ready (${codingProblems.length} bundled problems)`);
};

const seedCompanyPacks = async () => {
  await CompanyPack.bulkWrite(companyPacks.map((pack) => ({
    updateOne: { filter: { slug: pack.slug }, update: { $set: pack }, upsert: true },
  })), { ordered: false });
  console.log(`Reviewed company packs ready (${companyPacks.length} bundled packs)`);
};

const start = async () => {
  await connectDB();
  await Promise.all([Question.init(), QuizAttempt.init(), SqlProblem.init(), SqlAttempt.init(), CodingProblem.init(), CodeAttempt.init(), CompanyPack.init(), DailyChallengeAttempt.init()]);
  await seedQuestionBank();
  await seedSqlProblems();
  await seedCodingProblems();
  await seedCompanyPacks();
  const port = process.env.PORT || 6007;
  const server = app.listen(port, "0.0.0.0", () => console.log(`Practice service started on ${port}`));
  const shutdown = (signal) => {
    console.log(`${signal} received; shutting down practice service`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

start().catch((error) => {
  console.error("Failed to start practice service", error);
  process.exit(1);
});
