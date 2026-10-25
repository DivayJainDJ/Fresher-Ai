import redis from "../../../shared/redis/redis.js";
import User from "../../auth/model/user.model.js";
import CreditLedger from "../../billing/models/creditLedger.model.js";
import { COIN_COSTS } from "../../../shared/utils/coinCosts.js";
import { spendCoinsWithLedger, refundCoinsWithLedger } from "../../../shared/utils/coinAccounting.js";
import crypto from "node:crypto";

export const chargeCoins = (action) => async (req, res, next) => {
    const actionKey = action === "upload" ? "resume-scorer" : action;
    const cost = COIN_COSTS[actionKey];
    try {
        const userId = req.user?.userId || req.headers["x-user-id"];
        req.coinUserId = userId;
        req.coinCost = cost;
        next();
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const deductCoins = async (req, res, next) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "Resume PDF is required" });
        const userId = req.coinUserId;
        const cost = req.coinCost;
        const user = await spendCoinsWithLedger({ User, Ledger: CreditLedger, userId, action: "resume-scorer", eventKey: `spend:${crypto.randomUUID()}` });
        if (!user) return res.status(402).json({ success: false, message: "Not enough interview coins", code: "INSUFFICIENT_COINS" });
        req.user.interviewCoin = user.interviewCoin;
        req.coinCharge = { userId, cost, action: "resume-scorer", eventKey: user.ledgerEventKey };
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

const getSessionId = (req) =>
    req.cookies?.session ||
    req.headers["x-session-id"];

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
