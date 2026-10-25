import { z } from "zod";

export const topics = ["quantitative", "logical", "verbal", "os", "dbms", "networks", "oop"];
export const quizQuerySchema = z.object({
  topic: z.enum(topics),
  count: z.coerce.number().int().min(1).max(50).default(10),
  difficulty: z.enum(["easy", "medium", "hard", "mixed"]).default("mixed"),
});
export const submitSchema = z.object({
  quizId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(8).max(128),
  answers: z.array(z.object({ questionId: z.string().regex(/^[a-f\d]{24}$/i), selectedIndex: z.number().int().min(0).max(3).nullable() }).strict()).min(1).max(50),
}).strict();

export const publicQuestion = (question) => ({
  questionId: String(question._id), topic: question.topic, subtopic: question.subtopic,
  difficulty: question.difficulty, question: question.question, options: question.options,
});

export const scoreQuiz = (questions, answers) => {
  const submitted = new Map(answers.map((answer) => [String(answer.questionId), answer.selectedIndex]));
  const results = questions.map((question) => {
    const selectedIndex = submitted.get(String(question._id)) ?? null;
    return {
      questionId: String(question._id), topic: question.topic, question: question.question,
      options: question.options, selectedIndex, correctIndex: question.correctIndex,
      correct: selectedIndex === question.correctIndex, explanation: question.explanation,
    };
  });
  const byTopic = {};
  for (const result of results) {
    const item = byTopic[result.topic] || (byTopic[result.topic] = { correct: 0, total: 0, accuracy: 0 });
    item.total += 1;
    if (result.correct) item.correct += 1;
  }
  for (const item of Object.values(byTopic)) item.accuracy = Math.round((item.correct / item.total) * 100);
  const score = results.filter((result) => result.correct).length;
  return { results, score, total: results.length, accuracy: results.length ? Math.round(score / results.length * 100) : 0, perTopicAccuracy: byTopic };
};

export const createIdempotently = async ({ findExisting, create }) => {
  const existing = await findExisting();
  if (existing) return { record: existing, created: false };
  try {
    return { record: await create(), created: true };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const winner = await findExisting();
    if (!winner) throw error;
    return { record: winner, created: false };
  }
};
