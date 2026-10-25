import redis from "../../../shared/redis/redis.js";
import User from "../../auth/model/user.model.js";
import CreditLedger from "../../billing/models/creditLedger.model.js";
import { getCoinCost } from "../../../shared/utils/coinCosts.js";
import { spendCoinsWithLedger, refundCoinsWithLedger } from "../../../shared/utils/coinAccounting.js";
import crypto from "node:crypto";

const getSessionId = (req) =>
    req.cookies?.session || req.headers["x-session-id"];

export const isAuth = async (req, res, next) => {
    try {
        const sessionId = getSessionId(req);

        if (!sessionId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const session = await redis.get(`session:${sessionId}`);

        if (!session) {
            return res.status(401).json({ message: "Session Expired" });
        }

        req.user = JSON.parse(session);

        next();
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};

export const chargeCoins = (action) => async (req, res, next) => {
    try {
        const userId = req.user?.userId || req.headers["x-user-id"];
        const cost = getCoinCost(action);
        if (!cost) return res.status(400).json({ success: false, message: "Invalid coin action" });
        const requestedKey = action === "code-review" ? req.validatedCodeReview?.idempotencyKey : action === "behavioral-session" ? req.body?.idempotencyKey : null;
        if (action === "behavioral-session" && (!requestedKey || !/^[a-zA-Z0-9:_-]{8,128}$/.test(requestedKey))) {
            return res.status(400).json({ success: false, message: "Behavioral session requires a valid idempotencyKey" });
        }
        const eventKey = requestedKey ? `spend:${action}:${userId}:${requestedKey}` : `spend:${crypto.randomUUID()}`;
        const user = await spendCoinsWithLedger({ User, Ledger: CreditLedger, userId, action, eventKey });
        if (!user) return res.status(402).json({ success: false, message: "Not enough interview coins", code: "INSUFFICIENT_COINS" });
        req.coinCharge = { userId, cost, action, eventKey: user.ledgerEventKey, alreadyProcessed: user.alreadyProcessed === true };
        req.user.interviewCoin = user.interviewCoin;
        const sessionId = req.cookies?.session || req.headers["x-session-id"];
        if (sessionId) await redis.set(`session:${sessionId}`, JSON.stringify({ ...req.user, interviewCoin: user.interviewCoin }), "EX", 60 * 60 * 24 * 7);
        next();
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const refundCoins = async (req) => {
    if (!req.coinCharge) return;
    const user = await refundCoinsWithLedger({ User, Ledger: CreditLedger, userId: req.coinCharge.userId, action: req.coinCharge.action, eventKey: `refund:${req.coinCharge.eventKey}`, chargeEventKey: req.coinCharge.eventKey });
    const sessionId = req.cookies?.session || req.headers["x-session-id"];
    if (user && sessionId) await redis.set(`session:${sessionId}`, JSON.stringify({ userId: user._id, name: user.name, email: user.email, interviewCoin: user.interviewCoin }), "EX", 60 * 60 * 24 * 7);
};
