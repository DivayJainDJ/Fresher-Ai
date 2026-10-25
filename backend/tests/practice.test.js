import test from "node:test";
import assert from "node:assert/strict";
import Question from "../services/practice/models/Question.js";
import QuizAttempt from "../services/practice/models/QuizAttempt.js";
import { approvedQuestions } from "../services/practice/seeds/approvedQuestions.js";
import { createIdempotently, publicQuestion, quizQuerySchema, scoreQuiz, submitSchema } from "../services/practice/services/quizLogic.js";

test("fresh-clone question bank includes 20 approved questions for every topic", () => {
  const counts = approvedQuestions.reduce((grouped, question) => {
    (grouped[question.topic] ||= []).push(question);
    return grouped;
  }, {});
  for (const topic of ["quantitative", "logical", "verbal", "os", "dbms", "networks", "oop"]) {
    assert.equal(counts[topic]?.length, 20, `${topic} question count`);
    assert.ok(counts[topic].every((question) => question.status === "approved"));
  }
});

test("public quiz question projection does not expose answer or explanation fields", () => {
  const projected = publicQuestion({ _id: "q1", topic: "os", subtopic: "memory", difficulty: "easy", question: "What?", options: ["A", "B"], correctIndex: 1, explanation: "private" });
  assert.deepEqual(Object.keys(projected).sort(), ["difficulty", "options", "question", "questionId", "subtopic", "topic"].sort());
  assert.equal("correctIndex" in projected, false);
  assert.equal("explanation" in projected, false);
});

test("quiz scoring is server-side and produces per-topic accuracy", () => {
  const scored = scoreQuiz([
    { _id: "one", topic: "os", question: "A?", options: ["A", "B"], correctIndex: 1, explanation: "B is right" },
    { _id: "two", topic: "dbms", question: "B?", options: ["A", "B"], correctIndex: 0, explanation: "A is right" },
  ], [{ questionId: "one", selectedIndex: 1 }, { questionId: "two", selectedIndex: 1 }]);
  assert.equal(scored.score, 1);
  assert.equal(scored.accuracy, 50);
  assert.equal(scored.perTopicAccuracy.os.accuracy, 100);
  assert.equal(scored.perTopicAccuracy.dbms.accuracy, 0);
  assert.equal(scored.results[0].correctIndex, 1);
});

test("quiz request validation enforces supported topics and bounded count", () => {
  assert.equal(quizQuerySchema.safeParse({ topic: "oop", count: "20", difficulty: "hard" }).success, true);
  assert.equal(quizQuerySchema.safeParse({ topic: "history", count: "20" }).success, false);
  assert.equal(quizQuerySchema.safeParse({ topic: "os", count: "51" }).success, false);
});

test("same-user idempotency key is protected by a unique database index", () => {
  assert.ok(QuizAttempt.schema.indexes().some(([keys, options]) => keys.userId === 1 && keys.idempotencyKey === 1 && options.unique));
  const parsed = submitSchema.safeParse({ quizId: "quiz", idempotencyKey: "idempotency-123", answers: [{ questionId: "0123456789abcdef01234567", selectedIndex: 2 }] });
  assert.equal(parsed.success, true);
  assert.equal(submitSchema.safeParse({ quizId: "quiz", idempotencyKey: "x", answers: [{ questionId: "0123456789abcdef01234567", selectedIndex: -1 }] }).success, false);
});

test("idempotent create returns the saved attempt on repeat or a concurrent duplicate", async () => {
  const attempts = new Map();
  const record = { _id: "attempt-1", score: 2 };
  const findExisting = async () => attempts.get("user:key") || null;
  const create = async () => {
    if (attempts.has("user:key")) throw Object.assign(new Error("duplicate"), { code: 11000 });
    attempts.set("user:key", record);
    return record;
  };
  const [first, replay] = await Promise.all([
    createIdempotently({ findExisting, create }),
    createIdempotently({ findExisting, create }),
  ]);
  assert.equal([first, replay].filter((result) => result.created).length, 1);
  assert.equal(first.record, record);
  assert.equal(replay.record, record);
  assert.equal(attempts.size, 1);
});

test("seeded question schema includes the required quiz properties", () => {
  const question = approvedQuestions[0];
  for (const field of ["topic", "subtopic", "difficulty", "options", "correctIndex", "explanation", "status"]) assert.ok(field in question);
  assert.equal(Question.schema.path("correctIndex").instance, "Number");
});
