import crypto from "node:crypto";
import { getCoinCost } from "./coinCosts.js";
import { ensureOpeningLedger } from "./ensureOpeningLedger.js";

export const spendCoinsWithLedger = async ({ User, Ledger, userId, action, session, eventKey, sessionFactory = () => User.startSession() }) => {
  const cost = getCoinCost(action);
  if (!cost) return null;
  const ledgerKey = eventKey || `spend:${crypto.randomUUID()}`;
  const doSpend = async (transactionSession) => {
    const priorQuery = Ledger.findOne({ eventKey: ledgerKey });
    const prior = await (transactionSession ? priorQuery.session(transactionSession) : priorQuery);
    if (prior) {
      const existingUser = await User.findById(userId, null, transactionSession ? { session: transactionSession } : {});
      return existingUser ? { ...(typeof existingUser.toObject === "function" ? existingUser.toObject() : existingUser), interviewCoin: existingUser.interviewCoin, ledgerEventKey: ledgerKey, alreadyProcessed: true } : null;
    }
    const openingUser = await ensureOpeningLedger({ User, Ledger, userId, session: transactionSession });
    if (!openingUser) return null;
    const updated = await User.findOneAndUpdate(
      { _id: userId, interviewCoin: { $gte: cost } },
      { $inc: { interviewCoin: -cost } },
      { new: true, ...(transactionSession ? { session: transactionSession } : {}) }
    );
    if (!updated) return null;
    await Ledger.create([{ userId, amount: -cost, type: "spend", action, eventKey: ledgerKey }], transactionSession ? { session: transactionSession } : {});
    return { ...(typeof updated.toObject === "function" ? updated.toObject() : updated), interviewCoin: updated.interviewCoin, ledgerEventKey: ledgerKey };
  };
  if (session) return doSpend(session);
  const dbSession = await sessionFactory();
  try { let result; await dbSession.withTransaction(async () => { result = await doSpend(dbSession); }); return result; }
  finally { await dbSession.endSession(); }
};

export const refundCoinsWithLedger = async ({ User, Ledger, userId, action, session, eventKey, chargeEventKey, sessionFactory = () => User.startSession() }) => {
  const cost = getCoinCost(action);
  if (!cost) return null;
  const ledgerKey = eventKey || `refund:${crypto.randomUUID()}`;
  const doRefund = async (transactionSession) => {
    if (eventKey) {
      const refundedQuery = Ledger.exists({ eventKey: ledgerKey });
      const refunded = await (transactionSession ? refundedQuery.session(transactionSession) : refundedQuery);
      if (refunded) return null;
    }
    if (chargeEventKey) {
      const chargeQuery = Ledger.exists({ eventKey: chargeEventKey });
      const charge = await (transactionSession ? chargeQuery.session(transactionSession) : chargeQuery);
      if (!charge) return null;
    }
    const updated = await User.findByIdAndUpdate(userId, { $inc: { interviewCoin: cost } }, { new: true, ...(transactionSession ? { session: transactionSession } : {}) });
    if (!updated) return null;
    await Ledger.create([{ userId, amount: cost, type: "refund", action, eventKey: ledgerKey }], transactionSession ? { session: transactionSession } : {});
    return updated;
  };
  if (session) return doRefund(session);
  const dbSession = await sessionFactory();
  try { let result; await dbSession.withTransaction(async () => { result = await doRefund(dbSession); }); return result; }
  finally { await dbSession.endSession(); }
};

export const grantCoinsWithLedger = async ({ User, Ledger, userId, amount, type = "signup", eventKey, sessionFactory = () => User.startSession() }) => {
  if (!Number.isInteger(amount) || amount <= 0) throw new TypeError("Coin grant amount must be a positive integer");
  const ledgerKey = eventKey || `${type}:${userId}:${crypto.randomUUID()}`;
  const session = await sessionFactory();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await Ledger.findOne({ eventKey: ledgerKey }).session(session);
      if (prior) { result = { alreadyProcessed: true }; return; }
      const user = await User.findByIdAndUpdate(userId, { $inc: { interviewCoin: amount } }, { new: true, session });
      if (!user) throw new Error("User not found while granting credits");
      await Ledger.create([{ userId, amount, type, eventKey: ledgerKey }], { session });
      result = { user, amount };
    });
    return result;
  } finally { await session.endSession(); }
};

export const createUserWithWelcomeCredits = async ({ User, Ledger, userData, amount = 150, sessionFactory = () => User.startSession() }) => {
  const session = await sessionFactory();
  try {
    let created;
    await session.withTransaction(async () => {
      [created] = await User.create([{ ...userData, interviewCoin: amount }], { session });
      await Ledger.create([{ userId: created._id, amount, type: "signup", eventKey: `signup:${created.firebaseUid}` }], { session });
    });
    return created;
  } finally { await session.endSession(); }
};
