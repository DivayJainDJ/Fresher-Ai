import CodingProblem from "../models/CodingProblem.js";
import CodeAttempt from "../models/CodeAttempt.js";
import { codeAttemptSchema, codingLanguageSchema, codingProblemIdSchema } from "../services/codingLogic.js";
import { publishSafely } from "../../../shared/events/bus.js";

const userIdFor = (req) => req.user?.userId || req.user?._id;

export const listCodingProblems = async (req, res) => {
  try {
    const problems = await CodingProblem.find({ status: "approved" })
      .select("slug title statement constraints functionName starterCode visibleTests difficulty topicTags")
      .sort({ difficulty: 1, title: 1 }).lean();
    return res.json({ problems });
  } catch (error) {
    console.error(JSON.stringify({ service: "practice", event: "coding_problem_list_failed", requestId: req.requestId || null, error: error.message }));
    return res.status(503).json({ message: "Coding problems are temporarily unavailable" });
  }
};

// Hidden tests are sent only when a signed-in user submits a solution.
export const getCodingSubmissionTests = async (req, res) => {
  const problemId = codingProblemIdSchema.safeParse(req.params.problemId);
  const language = codingLanguageSchema.safeParse(req.body?.language);
  if (!problemId.success || !language.success || Object.keys(req.body || {}).some((key) => key !== "language")) {
    return res.status(400).json({ message: "Invalid coding submission" });
  }
  try {
    const problem = await CodingProblem.findOne({ _id: problemId.data, status: "approved" })
      .select("functionName visibleTests +hiddenTests").lean();
    if (!problem) return res.status(404).json({ message: "Coding problem not found" });
    return res.json({ functionName: problem.functionName, hiddenTests: problem.hiddenTests });
  } catch (error) {
    console.error(JSON.stringify({ service: "practice", event: "coding_tests_fetch_failed", requestId: req.requestId || null, error: error.message }));
    return res.status(503).json({ message: "Could not load submission tests" });
  }
};

export const recordCodeAttempt = async (req, res) => {
  const problemId = codingProblemIdSchema.safeParse(req.params.problemId);
  if (!problemId.success) return res.status(400).json({ message: "Invalid coding problem ID" });
  const parsed = codeAttemptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid coding attempt", errors: parsed.error.flatten() });
  const userId = userIdFor(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  try {
    const problem = await CodingProblem.findOne({ _id: problemId.data, status: "approved" }).select("topicTags title").lean();
    if (!problem) return res.status(404).json({ message: "Coding problem not found" });
    // Browser-side grading can be tampered with. These attempts drive practice stats only—never coins or authoritative leaderboards.
    const attempt = await CodeAttempt.create({ userId, problemId: problem._id, ...parsed.data, submittedAt: new Date() });
    const score = Math.round((parsed.data.passedCount / parsed.data.totalCount) * 100);
    await publishSafely("code.submitted", {
      eventId: `code.submitted:${attempt._id}`, userId: String(userId), module: "coding",
      result: { attemptId: String(attempt._id), problemId: String(problem._id), title: problem.title, topicTags: problem.topicTags, score, passedCount: parsed.data.passedCount, totalCount: parsed.data.totalCount, runtimeMs: parsed.data.runtimeMs, weakTopics: score < 70 ? problem.topicTags : [] },
    }, { service: "practice", requestId: req.requestId });
    return res.status(201).json({ attemptId: String(attempt._id), score, passedCount: attempt.passedCount, totalCount: attempt.totalCount, runtimeMs: attempt.runtimeMs });
  } catch (error) {
    console.error(JSON.stringify({ service: "practice", event: "coding_attempt_save_failed", requestId: req.requestId || null, error: error.message }));
    return res.status(503).json({ message: "Could not save coding attempt" });
  }
};
