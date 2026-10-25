import crypto from "node:crypto";
import Question from "../models/Question.js";
import DailyChallengeAttempt from "../models/DailyChallengeAttempt.js";
import { publishSafely } from "../../../shared/events/bus.js";
import { publicQuestion } from "../services/quizLogic.js";

const today = () => new Date().toISOString().slice(0, 10);
const userIdFor = (req) => req.user?.userId || req.user?._id;
const dailyQuestion = async () => {
  const ids = await Question.find({ status: "approved" }).sort({ _id: 1 }).select("_id").lean();
  if (!ids.length) return null;
  const date = today();
  const slot = crypto.createHash("sha256").update(`fresherai-daily:${date}`).digest().readUInt32BE(0) % ids.length;
  return Question.findById(ids[slot]._id).lean();
};

export const getDailyChallenge = async (_req, res) => {
  try {
    const question = await dailyQuestion();
    if (!question) return res.status(404).json({ message: "No approved daily challenge is available" });
    return res.json({ date: today(), question: publicQuestion(question) });
  } catch { return res.status(503).json({ message: "Daily challenge is temporarily unavailable" }); }
};

export const submitDailyChallenge = async (req, res) => {
  const selectedIndex = req.body?.selectedIndex;
  if (Object.keys(req.body || {}).some((key) => key !== "selectedIndex") || !(selectedIndex === null || Number.isInteger(selectedIndex))) return res.status(400).json({ message: "Choose an answer or submit null" });
  try {
    const question = await dailyQuestion();
    if (!question) return res.status(404).json({ message: "No approved daily challenge is available" });
    if (selectedIndex !== null && (selectedIndex < 0 || selectedIndex >= question.options.length)) return res.status(400).json({ message: "Answer choice is out of range" });
    const userId = userIdFor(req);
    const date = today();
    const correct = selectedIndex === question.correctIndex;
    let attempt;
    try { attempt = await DailyChallengeAttempt.create({ userId, date, questionId: question._id, selectedIndex, correct }); }
    catch (error) {
      if (error.code !== 11000) throw error;
      attempt = await DailyChallengeAttempt.findOne({ userId, date });
      return res.json({ alreadySubmitted: true, correct: attempt.correct, explanation: question.explanation });
    }
    const result = { score: correct ? 1 : 0, total: 1, accuracy: correct ? 100 : 0, weakTopics: correct ? [] : [question.subtopic], perTopicAccuracy: { [question.topic]: { correct: correct ? 1 : 0, total: 1, accuracy: correct ? 100 : 0 } } };
    await publishSafely("quiz.completed", { eventId: `daily-challenge:${date}:${userId}`, userId: String(userId), module: "quiz", timezone: req.headers["x-timezone"], result }, { service: "practice", requestId: req.requestId });
    if (!correct) await publishSafely("mistake.recorded", { eventId: `mistake.daily:${date}:${userId}`, userId: String(userId), module: "quiz", result: { mistakes: [{ topic: question.topic, questionRef: String(question._id), question: question.question, userAnswer: selectedIndex == null ? "No answer submitted" : question.options[selectedIndex], correctAnswer: question.options[question.correctIndex], reviewHint: question.explanation }] } }, { service: "practice", requestId: req.requestId });
    return res.status(201).json({ alreadySubmitted: false, correct, explanation: question.explanation });
  } catch { return res.status(503).json({ message: "Could not save daily challenge result" }); }
};
