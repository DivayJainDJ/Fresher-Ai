import crypto from "node:crypto";
import Question from "../models/Question.js";
import QuizAttempt from "../models/QuizAttempt.js";
import { publishSafely } from "../../../shared/events/bus.js";
import { quizQuerySchema, submitSchema, publicQuestion, scoreQuiz, createIdempotently } from "../services/quizLogic.js";

const userIdFor = (req) => req.user?.userId || req.user?._id;

export const getQuiz = async (req, res) => {
  const parsed = quizQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid quiz options", errors: parsed.error.flatten() });
  const { topic, count, difficulty } = parsed.data;
  const filter = { topic, status: "approved" };
  if (difficulty !== "mixed") filter.difficulty = difficulty;
  try {
    const questions = await Question.aggregate([
      { $match: filter }, { $sample: { size: count } },
      { $project: { _id: 1, topic: 1, subtopic: 1, difficulty: 1, question: 1, options: 1 } },
    ]);
    if (!questions.length) return res.status(404).json({ message: "No approved questions are available for this selection" });
    return res.json({ quizId: crypto.randomUUID(), topic, count: questions.length, questions: questions.map(publicQuestion) });
  } catch (error) {
    console.error(JSON.stringify({ service: "practice", event: "quiz_load_failed", requestId: req.requestId || null, error: error.message }));
    return res.status(503).json({ message: "Quiz is temporarily unavailable" });
  }
};

export const submitQuiz = async (req, res) => {
 try {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid quiz submission", errors: parsed.error.flatten() });
  const userId = userIdFor(req);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  const { quizId, idempotencyKey, answers } = parsed.data;
  const previous = await QuizAttempt.findOne({ userId, idempotencyKey });
  if (previous) return res.json({ attemptId: String(previous._id), score: previous.score, total: previous.total, accuracy: previous.accuracy, perTopicAccuracy: previous.perTopicAccuracy, results: previous.answers, replayed: true });

  const uniqueIds = [...new Set(answers.map((answer) => answer.questionId))];
  if (uniqueIds.length !== answers.length) return res.status(400).json({ message: "Each question can only be answered once" });
  const questions = await Question.find({ _id: { $in: uniqueIds }, status: "approved" }).lean();
  if (questions.length !== answers.length) return res.status(400).json({ message: "Submission contains an unavailable question" });
  const scored = scoreQuiz(questions, answers);
  const topic = [...new Set(questions.map((question) => question.topic))].join(",");
  let saved;
  try {
    saved = await createIdempotently({
      findExisting: () => QuizAttempt.findOne({ userId, idempotencyKey }),
      create: () => QuizAttempt.create({ userId, idempotencyKey, quizId, topic, ...scored, submittedAt: new Date() }),
    });
  } catch (error) {
    console.error(JSON.stringify({ service: "practice", event: "quiz_submit_failed", requestId: req.requestId || null, error: error.message }));
    return res.status(503).json({ message: "Could not save quiz results" });
  }
  const { record: attempt, created } = saved;
  if (!created) return res.json({ attemptId: String(attempt._id), score: attempt.score, total: attempt.total, accuracy: attempt.accuracy, perTopicAccuracy: attempt.perTopicAccuracy, results: attempt.answers, replayed: true });

  const weakTopics = Object.entries(scored.perTopicAccuracy).filter(([, stats]) => stats.accuracy < 60).map(([name]) => name);
  await publishSafely("quiz.completed", {
    eventId: `quiz.completed:${attempt._id}`, userId: String(userId), module: "quiz",
    result: { attemptId: String(attempt._id), score: scored.score, total: scored.total, accuracy: scored.accuracy, perTopicAccuracy: scored.perTopicAccuracy, weakTopics },
  }, { service: "practice", requestId: req.requestId });
  return res.status(201).json({ attemptId: String(attempt._id), score: scored.score, total: scored.total, accuracy: scored.accuracy, perTopicAccuracy: scored.perTopicAccuracy, results: scored.results, replayed: false });
 } catch (error) {
  console.error(JSON.stringify({ service: "practice", event: "quiz_submit_unhandled", requestId: req.requestId || null, error: error.message }));
  if (!res.headersSent) return res.status(503).json({ message: "Quiz submission is temporarily unavailable" });
 }
};
