import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { cleanJson } from "../shared/utils/json.js";
import { getCoinCost, canSpendCoins } from "../shared/utils/coinCosts.js";
import { verifyPaymentSignature, verifyWebhookSignature } from "../shared/utils/paymentSignature.js";
import { rateLimitDecision } from "../shared/utils/rateLimitDecision.js";
import { fixedWindowScript, tokenBucketDecision, tokenBucketScript } from "../shared/utils/tokenBucket.js";
import { resetCircuit } from "../shared/utils/circuitBreaker.js";
import { buildResumeEvalCases, summarizeScores } from "../services/resume/evaluation/resumeCases.js";
process.env.NODE_ENV = "test";
const { invokeWithRetry, getLlmMetrics } = await import("../shared/utils/cleanJson.js");

test("cleanJson removes fenced output and hidden reasoning", () => {
  assert.equal(cleanJson('<think>hidden</think>```json\n{"score":42}\n```'), '{"score":42}');
});

test("resume evaluation harness creates 30 original samples and reports repeatability/agreement", () => {
  const cases = buildResumeEvalCases(30);
  assert.equal(cases.length, 30);
  assert.equal(new Set(cases.map((sample) => sample.id)).size, 30);
  assert.equal(cases.every((sample) => sample.text.includes("original synthetic evaluation text")), true);
  assert.deepEqual(summarizeScores([70, 70, 80], 75), { runs: 3, mean: 73.33, standardDeviation: 4.71, referenceScore: 75, absoluteError: 1.67, agreementWithinFive: true });
  assert.throws(() => buildResumeEvalCases(51), RangeError);
});

test("coin costs ignore client amounts and reject insufficient balance", () => {
  assert.equal(getCoinCost("start-interview"), 50);
  assert.equal(getCoinCost("interview-feedback"), 5);
  assert.equal(getCoinCost("forged-action"), null);
  assert.equal(canSpendCoins(20, "roadmap-builder"), true);
  assert.equal(canSpendCoins(19, "roadmap-builder"), false);
});

const query = (getValue) => ({ session() { return this; }, then(resolve, reject) { return Promise.resolve().then(getValue).then(resolve, reject); } });

test("production spend helper is atomic, ledger-backed, and idempotent under 50 parallel requests", async () => {
  const state = { balance: 500, entries: [] };
  let transactionQueue = Promise.resolve();
  const sessionFactory = async () => ({
    withTransaction(work) {
      const run = transactionQueue.then(async () => {
        const before = structuredClone(state);
        try { return await work(); } catch (error) { Object.assign(state, before); throw error; }
      });
      transactionQueue = run.catch(() => {});
      return run;
    },
    async endSession() {},
  });
  const User = {
    startSession: sessionFactory,
    findById: async () => ({ interviewCoin: state.balance }),
    async findOneAndUpdate(filter, update, options) {
      assert.ok(options.session);
      if (state.balance < filter.interviewCoin.$gte) return null;
      state.balance += update.$inc.interviewCoin;
      return { interviewCoin: state.balance };
    },
  };
  const Ledger = {
    findOne: (filter) => query(() => state.entries.find((entry) => Object.entries(filter).every(([key, value]) => String(entry[key]) === String(value))) || null),
    create: async (entries, options) => { assert.ok(options.session); state.entries.push(...entries); },
  };
  const { spendCoinsWithLedger } = await import("../shared/utils/coinAccounting.js");
  const results = await Promise.all(Array.from({ length: 50 }, () => spendCoinsWithLedger({ User, Ledger, userId: "user-1", action: "start-interview", sessionFactory })));
  assert.equal(results.filter(Boolean).length, 10);
  assert.equal(state.balance, 0);
  assert.equal(state.entries.filter((entry) => entry.type === "spend").length, 10);
  assert.equal(state.entries.find((entry) => entry.type === "opening").amount, 500);
  const retry = await spendCoinsWithLedger({ User, Ledger, userId: "user-1", action: "start-interview", eventKey: results.find(Boolean).ledgerEventKey, sessionFactory });
  assert.equal(retry.alreadyProcessed, true);
  assert.equal(state.balance, 0);
});

test("credit purchase ledger and balance update roll back together on failed transaction work", async () => {
  const state = { balance: 0, paid: false, ledger: [] };
  const session = {
    async withTransaction(work) {
      const before = structuredClone(state);
      try { await work(); } catch (error) { Object.assign(state, before); throw error; }
    },
    async endSession() {},
  };
  const Billing = {
    startSession: async () => session,
    findOneAndUpdate: async (filter, update, options) => {
      assert.equal(options.session, session);
      if (state.paid) return null;
      state.paid = update.$set.status === "paid";
      return { _id: "bill-1", userId: "user-1", interviewCoins: 300 };
    },
  };
  const User = {
    findById: async () => ({ interviewCoin: state.balance }),
    findByIdAndUpdate: async (_id, update, options) => {
      assert.equal(options.session, session);
      state.balance += update.$inc.interviewCoin;
      return { interviewCoin: state.balance };
    },
  };
  let failLedgerOnce = true;
  const Ledger = {
    findOne: (filter) => query(() => state.ledger.find((entry) => Object.entries(filter).every(([key, value]) => String(entry[key]) === String(value))) || null),
    create: async (rows, options) => { assert.equal(options.session, session); if (failLedgerOnce) { failLedgerOnce = false; throw new Error("simulated ledger write failure"); } state.ledger.push(...rows); },
  };
  const { settlePaidOrder } = await import("../shared/utils/settlePaidOrder.js");
  await assert.rejects(() => settlePaidOrder({ Billing, User, Ledger, orderId: "order-1", paymentId: "pay-1", sessionFactory: async () => session }));
  assert.deepEqual(state, { balance: 0, paid: false, ledger: [] });
  const settled = await settlePaidOrder({ Billing, User, Ledger, orderId: "order-1", paymentId: "pay-1", sessionFactory: async () => session });
  assert.equal(settled.user.interviewCoin, 300);
  assert.equal(state.ledger.length, 2);
  assert.equal(state.ledger.find((entry) => entry.type === "purchase").eventKey, "billing:bill-1");
  assert.equal(state.ledger.find((entry) => entry.type === "opening").amount, 0);
  assert.equal((await settlePaidOrder({ Billing, User, Ledger, orderId: "order-1", paymentId: "pay-1", sessionFactory: async () => session })).alreadyProcessed, true);
  assert.equal(state.balance, 300);
  assert.equal(state.ledger.length, 2);
});

test("credit spend and refund ledger entries share atomic database transactions", async () => {
  const state = { balance: 150, entries: [] };
  const sessionFactory = async () => ({ async withTransaction(work) { const before = structuredClone(state); try { return await work(); } catch (error) { Object.assign(state, before); throw error; } }, async endSession() {} });
  const User = {
    startSession: sessionFactory,
    findById: async () => ({ interviewCoin: state.balance }),
    findOneAndUpdate: async (filter, update, options) => {
      assert.ok(options.session);
      if (state.balance < filter.interviewCoin.$gte) return null;
      state.balance += update.$inc.interviewCoin;
      return { interviewCoin: state.balance };
    },
    findByIdAndUpdate: async (_id, update, options) => { assert.ok(options.session); state.balance += update.$inc.interviewCoin; return { interviewCoin: state.balance }; },
  };
  const Ledger = {
    findOne: (filter) => query(() => state.entries.find((entry) => Object.entries(filter).every(([key, value]) => String(entry[key]) === String(value))) || null),
    exists: (filter) => query(() => state.entries.some((entry) => Object.entries(filter).every(([key, value]) => String(entry[key]) === String(value))) || null),
    create: async (rows, options) => { assert.ok(options.session); state.entries.push(...rows); },
  };
  const { spendCoinsWithLedger, refundCoinsWithLedger } = await import("../shared/utils/coinAccounting.js");
  assert.equal((await spendCoinsWithLedger({ User, Ledger, userId: "u1", action: "start-interview", sessionFactory })).interviewCoin, 100);
  assert.equal(state.entries.find((entry) => entry.type === "spend").amount, -50);
  const spendKey = state.entries.find((entry) => entry.type === "spend").eventKey;
  assert.equal((await refundCoinsWithLedger({ User, Ledger, userId: "u1", action: "start-interview", eventKey: `refund:${spendKey}`, chargeEventKey: spendKey, sessionFactory })).interviewCoin, 150);
  assert.equal(state.entries.find((entry) => entry.type === "refund").amount, 50);
  assert.equal(await refundCoinsWithLedger({ User, Ledger, userId: "u1", action: "start-interview", eventKey: `refund:${spendKey}`, chargeEventKey: spendKey, sessionFactory }), null);
  assert.equal(state.balance, 150);
  assert.equal(await spendCoinsWithLedger({ User, Ledger, userId: "u1", action: "bad-action", sessionFactory }), null);
});

test("Razorpay signature verifier accepts only a matching HMAC", () => {
  const secret = "test-secret";
  const orderId = "order-1";
  const paymentId = "pay-1";
  const signature = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  assert.equal(verifyPaymentSignature(orderId, paymentId, signature, secret), true);
  assert.equal(verifyPaymentSignature(orderId, paymentId, "0".repeat(64), secret), false);
  assert.equal(verifyPaymentSignature(orderId, paymentId, "", secret), false);
  const body = Buffer.from('{"event":"payment.captured"}');
  const webhookSignature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyWebhookSignature(body, webhookSignature, secret), true);
  assert.equal(verifyWebhookSignature(Buffer.from("tampered"), webhookSignature, secret), false);
});

test("rate limit decision rejects excess calls and returns a retry delay", () => {
  assert.deepEqual(rateLimitDecision(12, 12, 40_000), { allowed: true, retryAfter: 0 });
  assert.deepEqual(rateLimitDecision(13, 12, 1_200), { allowed: false, retryAfter: 2 });
});

test("provider fallback succeeds when the primary provider fails", async () => {
  resetCircuit();
  const providers = [
    { name: "groq-test", call: async () => { throw new Error("blocked provider"); } },
    { name: "gemini-test", call: async () => "{\"ok\":true}" },
  ];
  const observed = { increments: [], latencies: [], failoverLatencies: [] };
  const metricsSink = {
    increment: async (name) => observed.increments.push(name),
    providerLatency: async (provider, value) => observed.latencies.push({ provider, value }),
    failoverLatency: async (value) => observed.failoverLatencies.push(value),
  };
  const result = await invokeWithRetry({}, [{ role: "user", content: "test prompt" }], 1, { skipCache: true, providers, metricsSink });
  assert.equal(result.content, '{"ok":true}');
  assert.equal(getLlmMetrics().providerSuccess["gemini-test"], 1);
  assert.equal(getLlmMetrics().failovers, 1);
  assert.ok(getLlmMetrics().providerLatencyMs["gemini-test"].count >= 1);
  assert.equal(await getLlmMetrics().providerSuccess.groq, undefined);
  assert.deepEqual(observed.increments, ["providerSuccess:gemini-test", "failovers"]);
  assert.ok(observed.failoverLatencies[0] >= 0);
});

test("LLM cache records hits/misses and skipCache bypasses both", async () => {
  const cacheState = new Map();
  const observed = [];
  const metricsSink = { increment: async (name) => observed.push(name), providerLatency: async () => {}, failoverLatency: async () => {} };
  const cache = { get: async (key) => cacheState.get(key) || null, set: async (key, value) => cacheState.set(key, value) };
  let calls = 0;
  const providers = [{ name: "cache-test", call: async () => { calls += 1; return "cached answer"; } }];
  const messages = [{ role: "user", content: "unique cache prompt" }];
  await invokeWithRetry({}, messages, 1, { providers, cache, metricsSink });
  const cached = await invokeWithRetry({}, messages, 1, { providers, cache, metricsSink });
  assert.equal(cached.content, "cached answer");
  assert.equal(calls, 1);
  await invokeWithRetry({}, messages, 1, { providers, cache, metricsSink, skipCache: true });
  assert.equal(calls, 2);
  assert.deepEqual(observed.slice(0, 3), ["cacheMisses", "providerSuccess:cache-test", "cacheHits"]);
});

test("token bucket permits bursts, refills by elapsed time, and computes 429 delay", () => {
  assert.match(tokenBucketScript, /redis\.call\('HSET'/);
  const consumed = tokenBucketDecision({ tokens: 2, updatedAt: 1000, now: 1000, capacity: 2, refillPerSecond: 1 });
  assert.deepEqual(consumed, { allowed: true, tokens: 1, updatedAt: 1000, retryAfter: 0 });
  const blocked = tokenBucketDecision({ tokens: 0, updatedAt: 1000, now: 1000, capacity: 2, refillPerSecond: 0.5 });
  assert.deepEqual(blocked, { allowed: false, tokens: 0, updatedAt: 1000, retryAfter: 2 });
  const refilled = tokenBucketDecision({ tokens: 0, updatedAt: 1000, now: 3000, capacity: 2, refillPerSecond: 1 });
  assert.deepEqual(refilled, { allowed: true, tokens: 1, updatedAt: 3000, retryAfter: 0 });
  assert.match(fixedWindowScript, /PEXPIRE/);
});

test("token bucket middleware returns a parseable 429 and Retry-After", async () => {
  const { tokenBucketRateLimiter } = await import("../gateway/middleware/rateLimiter.js");
  const middleware = tokenBucketRateLimiter({ redisClient: { eval: async () => [0, 3] } });
  const response = { headers: {}, statusCode: 200, body: null, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let nextCalled = false;
  await middleware({ user: { userId: "u1" }, headers: {}, ip: "127.0.0.1" }, response, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["Retry-After"], 3);
  assert.equal(response.body.retryAfter, 3);
});

test("circuit breakers can be reset between tests", () => {
  resetCircuit();
  assert.ok(true);
});

test("progress event replay creates one progress event and increments once", async () => {
  const state = { events: new Map(), progress: null };
  const query = (value) => ({ session() { return this; }, lean() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
  const EventModel = {
    findOne: ({ eventId }) => query(state.events.get(eventId) || null),
    create: async (rows) => { for (const row of rows) state.events.set(row.eventId, row); },
  };
  const ProgressModel = {
    findOne: () => query(state.progress),
    async findOneAndUpdate(_filter, update) {
      if (!state.progress) state.progress = { modules: new Map(), currentStreak: 0, longestStreak: 0, lastActivityDate: null, weakTopics: [] };
      const module = "interview";
      const stats = state.progress.modules.get(module) || { completed: 0, scoreCount: 0, scoreTotal: 0, averageScore: null, lastActivityAt: null };
      stats.completed += update.$inc[`modules.${module}.completed`];
      stats.scoreCount += update.$inc[`modules.${module}.scoreCount`];
      stats.scoreTotal += update.$inc[`modules.${module}.scoreTotal`];
      stats.lastActivityAt = update.$max[`modules.${module}.lastActivityAt`];
      state.progress.modules.set(module, stats);
      state.progress.currentStreak = update.$set.currentStreak;
      state.progress.longestStreak = Math.max(state.progress.longestStreak, update.$max.longestStreak);
      state.progress.lastActivityDate = update.$set.lastActivityDate;
      state.progress.modules.set = Map.prototype.set.bind(state.progress.modules);
      state.progress.save = async () => {};
      return state.progress;
    },
  };
  const sessionFactory = async () => ({ withTransaction: async (work) => work(), endSession: async () => {} });
  const { processProgressEvent } = await import("../services/progress/services/processProgressEvent.js");
  const event = { eventId: "interview:1", type: "interview.completed", userId: "507f1f77bcf86cd799439011", timestamp: "2026-10-24T12:00:00.000Z", module: "interview", result: { score: 80, weakTopics: ["SQL joins"] } };
  const options = { EventModel, ProgressModel, sessionFactory, now: () => new Date("2026-10-24T12:00:01.000Z") };
  assert.equal((await processProgressEvent(event, options)).duplicate, false);
  assert.equal((await processProgressEvent(event, options)).duplicate, true);
  assert.equal(state.events.size, 1);
  assert.equal(state.progress.modules.get("interview").completed, 1);
});

test("event bus retries failures then writes to dead-letter stream and acknowledges", async () => {
  process.env.NODE_ENV = "test";
  const { createStreamConsumer } = await import("../shared/events/bus.js");
  const written = [];
  const acknowledged = [];
  const client = {
    xadd: async (...args) => { written.push(args); return "2-0"; },
    xack: async (...args) => { acknowledged.push(args); return 1; },
  };
  const consumer = createStreamConsumer({ group: "test", consumer: "test-1", client, maxAttempts: 2, handler: async () => { throw new Error("simulated storage outage"); } });
  const event = { eventId: "resume:1", type: "resume.scored", userId: "507f1f77bcf86cd799439011", timestamp: "2026-10-24T12:00:00.000Z", module: "resume", result: { score: 70 } };
  const entry = (id, attempts) => [id, ["event", JSON.stringify(event), "attempts", String(attempts)]];
  assert.equal(await consumer.processEntry(entry("1-0", 0)), "retried");
  assert.equal(await consumer.processEntry(entry("2-0", 1)), "dead-lettered");
  assert.equal(written[0][0], "fresherai:events");
  assert.equal(written[1][0], "fresherai:events:dead");
  assert.equal(acknowledged.length, 2);
});

test("roadmap consumer marks interview weakness topics practiced", async () => {
  const { markInterviewTopicsPracticed } = await import("../services/roadmap/services/interviewEventWorker.js");
  const updates = [];
  const RoadmapModel = {
    find: async () => [{ _id: "roadmap-1", title: "Backend Engineer Roadmap", modules: [{ title: "SQL joins" }, { title: "System design" }] }],
    updateOne: async (...args) => updates.push(args),
  };
  await markInterviewTopicsPracticed(RoadmapModel, {
    type: "interview.completed",
    userId: "507f1f77bcf86cd799439011",
    timestamp: "2026-10-24T12:00:00.000Z",
    result: { role: "Backend Engineer", weakTopics: ["Needs practice with SQL joins"] },
  });
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0][1].$addToSet.practicedTopics.$each, ["SQL joins"]);
  assert.equal(updates[0][1].$set["modules.$[module].practiced"], true);
});
