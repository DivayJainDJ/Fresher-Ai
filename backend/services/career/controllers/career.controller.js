import crypto from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import Resume from "../config/resume.model.js";
import { matchJob, writeCoverLetter } from "../agents/career.agent.js";
import User from "../../auth/model/user.model.js";
import CreditLedger from "../../billing/models/creditLedger.model.js";
import { spendCoinsWithLedger, refundCoinsWithLedger } from "../../../shared/utils/coinAccounting.js";
import { publishSafely } from "../../../shared/events/bus.js";
import Application from "../models/application.model.js";

const isValidDateOnly = (value) => {
  if (!value) return true;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const applicationSchema = z.object({
  company: z.string().trim().min(1).max(120), role: z.string().trim().min(1).max(160),
  link: z.string().trim().max(2000).optional().default("").refine((value) => !value || /^https?:\/\//i.test(value), "Use a valid http or https job URL"),
  stage: z.enum(["wishlist", "applied", "oa", "interview", "offer", "rejected"]).optional(),
  notes: z.string().trim().max(5000).optional().default(""),
  nextActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().default("").refine(isValidDateOnly, "Use a real calendar date"),
}).strict();
const applicationUpdateSchema = applicationSchema.partial().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const listApplications = async (req, res) => {
  try { return res.json({ applications: await Application.find({ userId: validUserId(req) }).sort({ updatedAt: -1 }).lean() }); }
  catch (error) { return res.status(503).json({ message: "Applications are temporarily unavailable" }); }
};
export const createApplication = async (req, res) => {
  const parsed = applicationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid application details", errors: parsed.error.flatten() });
  try { const application = await Application.create({ ...parsed.data, userId: validUserId(req) }); return res.status(201).json({ application }); }
  catch { return res.status(503).json({ message: "Could not save application" }); }
};
export const updateApplication = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid application ID" });
  const parsed = applicationUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid application update", errors: parsed.error.flatten() });
  try {
    if (Object.hasOwn(parsed.data, "nextActionDate")) parsed.data.reminderSentForDate = "";
    const application = await Application.findOneAndUpdate({ _id: req.params.id, userId: validUserId(req) }, { $set: parsed.data }, { new: true, runValidators: true });
    return application ? res.json({ application }) : res.status(404).json({ message: "Application not found" });
  } catch { return res.status(503).json({ message: "Could not update application" }); }
};
export const deleteApplication = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid application ID" });
  try {
    const application = await Application.findOneAndDelete({ _id: req.params.id, userId: validUserId(req) });
    if (!application) return res.status(404).json({ message: "Application not found" });
    return res.json({ success: true });
  } catch { return res.status(503).json({ message: "Could not delete application" }); }
};

const matchRequest = z.object({ resumeId: z.string().optional(), jobText: z.string().trim().min(1).max(8000), fresh: z.boolean().optional() }).strict();
const coverRequest = z.object({ resumeId: z.string().optional(), jobText: z.string().trim().min(1).max(8000), match: z.unknown().optional(), fresh: z.boolean().optional() }).strict();
const validUserId = (req) => req.user?.userId || req.user?._id;
const keyFor = (kind, resume, jobText) => crypto.createHash("sha256").update(`${kind}\0${String(resume._id)}\0${resume.updatedAt?.toISOString() || ""}\0${jobText}`).digest("hex");
const cacheLockKey = (kind, key) => `career:lock:${kind}:${key}`;
const loadResume = async (userId, resumeId) => {
  if (resumeId && !mongoose.isValidObjectId(resumeId)) return null;
  return Resume.findOne({ userId, ...(resumeId ? { _id: resumeId } : {}) }).lean();
};
const charge = async (req, action, idempotencyKey) => {
  const userId = validUserId(req);
  const user = await spendCoinsWithLedger({ User, Ledger: CreditLedger, userId, action, eventKey: `spend:${action}:${userId}:${idempotencyKey}` });
  if (!user) return null;
  req.coinCharge = { userId, action, eventKey: user.ledgerEventKey };
  return user;
};
const refund = (req) => req.coinCharge && refundCoinsWithLedger({
  User, Ledger: CreditLedger, userId: req.coinCharge.userId, action: req.coinCharge.action,
  eventKey: `refund:${req.coinCharge.eventKey}`, chargeEventKey: req.coinCharge.eventKey,
});

export const postMatch = async (req, res) => {
  const parsed = matchRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Provide jobText between 1 and 8,000 characters and an optional resumeId", errors: parsed.error.flatten() });
  let charged = false;
  let lockKey;
  try {
    const resume = await loadResume(validUserId(req), parsed.data.resumeId);
    if (!resume) return res.status(404).json({ message: "Resume not found" });
    const cacheKey = keyFor("match", resume, parsed.data.jobText);
    const redis = (await import("../../../shared/redis/redis.js")).default;
    const cached = !parsed.data.fresh && await redis.get(`career:match:${cacheKey}`);
    if (cached) return res.json({ ...JSON.parse(cached), cached: true, charged: false });
    lockKey = cacheLockKey("match", parsed.data.fresh ? `${cacheKey}:${crypto.randomUUID()}` : cacheKey);
    const locked = await redis.set(lockKey, "1", "EX", 180, "NX");
    if (locked !== "OK") {
      const waitUntil = Date.now() + 20_000;
      while (Date.now() < waitUntil) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const concurrentResult = await redis.get(`career:match:${cacheKey}`);
        if (concurrentResult) return res.json({ ...JSON.parse(concurrentResult), cached: true, charged: false });
      }
      return res.status(409).json({ message: "This match is already being generated. Retry shortly." });
    }
    const chargeKey = parsed.data.fresh ? `${cacheKey}:fresh:${crypto.randomUUID()}` : cacheKey;
    const user = await charge(req, "jd-match", chargeKey);
    if (!user) { await redis.del(lockKey); return res.status(402).json({ message: "Not enough interview coins", code: "INSUFFICIENT_COINS" }); }
    charged = true;
    req.coinCharge.refundOnFailure = true;
    const result = await matchJob({ resumeText: resume.extractedText, jobText: parsed.data.jobText, skipCache: Boolean(parsed.data.fresh) });
    const response = { success: true, ...result, cached: false, charged: true };
    await redis.set(`career:match:${cacheKey}`, JSON.stringify(response), "EX", 6 * 60 * 60);
    await publishSafely("jd.matched", { eventId: `jd.matched:${cacheKey}`, userId: String(validUserId(req)), module: "resume", timezone: req.headers["x-timezone"], result: { matchScore: result.matchScore, matchedSkills: result.matchedSkills, missingSkills: result.missingSkills, resumeId: String(resume._id), cacheKey } }, { service: "career", requestId: req.requestId });
    res.setHeader("X-Interview-Coins", String(user.interviewCoin));
    await redis.del(lockKey);
    req.coinCharge.refundOnFailure = false;
    return res.json(response);
  } catch (error) {
    if (charged && req.coinCharge?.refundOnFailure) await refund(req).catch((refundError) => console.error("career match refund failed", refundError));
    if (lockKey) await (await import("../../../shared/redis/redis.js")).default.del(lockKey).catch(() => {});
    console.error(JSON.stringify({ service: "career", event: "jd_match_failed", requestId: req.requestId || null, error: error.message }));
    return res.status(503).json({ message: "Job match is temporarily unavailable; any coin charge was refunded" });
  }
};

export const postCoverLetter = async (req, res) => {
  const parsed = coverRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Provide jobText between 1 and 8,000 characters and an optional resumeId", errors: parsed.error.flatten() });
  let charged = false;
  let lockKey;
  try {
    const resume = await loadResume(validUserId(req), parsed.data.resumeId);
    if (!resume) return res.status(404).json({ message: "Resume not found" });
    const cacheKey = keyFor("cover-letter", resume, parsed.data.jobText);
    const redis = (await import("../../../shared/redis/redis.js")).default;
    const cached = !parsed.data.fresh && await redis.get(`career:cover:${cacheKey}`);
    if (cached) return res.json({ success: true, coverLetter: cached, cached: true, charged: false });
    const matchCacheKey = keyFor("match", resume, parsed.data.jobText);
    let match = parsed.data.match;
    if (!match) {
      const matchCached = await redis.get(`career:match:${matchCacheKey}`);
      match = matchCached ? JSON.parse(matchCached) : await matchJob({ resumeText: resume.extractedText, jobText: parsed.data.jobText });
    }
    const validMatch = z.object({ matchScore: z.number().finite().min(0).max(100), matchedSkills: z.array(z.string()), missingSkills: z.array(z.string()), bulletRewrites: z.array(z.object({ original: z.string(), improved: z.string() })).max(5), summary: z.string() }).safeParse(match);
    if (!validMatch.success) return res.status(400).json({ message: "The supplied match analysis is invalid" });
    lockKey = cacheLockKey("cover-letter", parsed.data.fresh ? `${cacheKey}:${crypto.randomUUID()}` : cacheKey);
    const locked = await redis.set(lockKey, "1", "EX", 180, "NX");
    if (locked !== "OK") {
      const waitUntil = Date.now() + 20_000;
      while (Date.now() < waitUntil) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const concurrentResult = await redis.get(`career:cover:${cacheKey}`);
        if (concurrentResult) return res.json({ success: true, coverLetter: concurrentResult, cached: true, charged: false });
      }
      return res.status(409).json({ message: "This cover letter is already being generated. Retry shortly." });
    }
    const chargeKey = parsed.data.fresh ? `${cacheKey}:fresh:${crypto.randomUUID()}` : cacheKey;
    const user = await charge(req, "cover-letter", chargeKey);
    if (!user) { await redis.del(lockKey); return res.status(402).json({ message: "Not enough interview coins", code: "INSUFFICIENT_COINS" }); }
    charged = true;
    req.coinCharge.refundOnFailure = true;
    const coverLetter = await writeCoverLetter({ resumeText: resume.extractedText, jobText: parsed.data.jobText, match, skipCache: Boolean(parsed.data.fresh) });
    await redis.set(`career:cover:${cacheKey}`, coverLetter, "EX", 6 * 60 * 60);
    await redis.del(lockKey);
    req.coinCharge.refundOnFailure = false;
    res.setHeader("X-Interview-Coins", String(user.interviewCoin));
    return res.json({ success: true, coverLetter, cached: false, charged: true });
  } catch (error) {
    if (charged && req.coinCharge?.refundOnFailure) await refund(req).catch((refundError) => console.error("cover letter refund failed", refundError));
    if (lockKey) await (await import("../../../shared/redis/redis.js")).default.del(lockKey).catch(() => {});
    console.error(JSON.stringify({ service: "career", event: "cover_letter_failed", requestId: req.requestId || null, error: error.message }));
    return res.status(503).json({ message: "Cover letter is temporarily unavailable; any coin charge was refunded" });
  }
};
