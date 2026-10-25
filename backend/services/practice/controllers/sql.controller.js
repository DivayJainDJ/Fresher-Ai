import SqlProblem from "../models/SqlProblem.js";
import SqlAttempt from "../models/SqlAttempt.js";
import { sqlAttemptSchema, sqlProblemIdSchema } from "../services/sqlLogic.js";
import { publishSafely } from "../../../shared/events/bus.js";

const userIdFor = (req) => req.user?.userId || req.user?._id;

export const listSqlProblems = async (req, res) => {
  try {
    const problems = await SqlProblem.find({ status: "approved" })
      .select("slug title description schemaSql seedSql expectedResult orderSensitive hint difficulty topic")
      .sort({ topic: 1, difficulty: 1, slug: 1 }).lean();
    return res.json({ problems });
  } catch (error) {
    console.error(JSON.stringify({ service: "practice", event: "sql_problem_list_failed", requestId: req.requestId || null, error: error.message }));
    return res.status(503).json({ message: "SQL problems are temporarily unavailable" });
  }
};

export const submitSqlAttempt = async (req, res) => {
  const problemId = sqlProblemIdSchema.safeParse(req.params.problemId);
  if (!problemId.success) return res.status(400).json({ message: "Invalid SQL problem ID" });
  const parsed = sqlAttemptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid SQL attempt", errors: parsed.error.flatten() });
  const userId = userIdFor(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const problem = await SqlProblem.findOne({ _id: problemId.data, status: "approved" }).select("topic").lean();
    if (!problem) return res.status(404).json({ message: "SQL problem not found" });
    const attempt = await SqlAttempt.create({ userId, problemId: problem._id, ...parsed.data, submittedAt: new Date() });
    if (parsed.data.passed) {
      await publishSafely("sql.completed", {
        eventId: `sql.completed:${attempt._id}`, userId: String(userId), module: "sql",
        result: { attemptId: String(attempt._id), problemId: String(problem._id), topic: problem.topic, score: 100, accuracy: 100, attemptMs: parsed.data.attemptMs, weakTopics: [] },
      }, { service: "practice", requestId: req.requestId });
    }
    return res.status(201).json({ attemptId: String(attempt._id), saved: true });
  } catch (error) {
    console.error(JSON.stringify({ service: "practice", event: "sql_attempt_save_failed", requestId: req.requestId || null, error: error.message }));
    return res.status(503).json({ message: "Could not save SQL attempt" });
  }
};
