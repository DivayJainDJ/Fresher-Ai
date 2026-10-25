import crypto from "crypto";
import redis from "../../../shared/redis/redis.js";
import extractText from "../config/pdf.js";
import { resumeAgent } from "../agents/resume.agent.js";
import Resume from "../models/resume.model.js";
import fs from "fs";
import User from "../../auth/model/user.model.js";
import CreditLedger from "../../billing/models/creditLedger.model.js";
import { refundCoinsWithLedger } from "../../../shared/utils/coinAccounting.js";
import { publishSafely } from "../../../shared/events/bus.js";
import { recordJobOutcome, recordQueueDepth } from "../../../shared/observability/prometheus.js";

const MAX_CONCURRENT_JOBS = Number(process.env.RESUME_CONCURRENCY || 2);
const JOB_TTL_SECONDS = 60 * 60;
let activeJobs = 0;
const pendingJobs = [];
let queuePolling = false;

const refreshQueueDepth = async () => {
  const queued = await redis.llen("resume-jobs");
  recordQueueDepth("resume", "resume-analysis", queued + pendingJobs.length + activeJobs);
};

const runNext = () => {
  while (activeJobs < MAX_CONCURRENT_JOBS && pendingJobs.length) {
    const job = pendingJobs.shift();
    activeJobs += 1;
    void refreshQueueDepth().catch(() => {});
    processJob(job).finally(() => {
      activeJobs -= 1;
      void refreshQueueDepth().catch(() => {});
      runNext();
    });
  }
};

const pollRedisQueue = async () => {
  if (queuePolling) return;
  queuePolling = true;
  try {
    while (activeJobs + pendingJobs.length < MAX_CONCURRENT_JOBS) {
      const rawJob = await redis.rpop("resume-jobs");
      if (!rawJob) break;
      pendingJobs.push(JSON.parse(rawJob));
    }
    runNext();
    await refreshQueueDepth();
  } catch (error) {
    console.error(JSON.stringify({ service: "resume", event: "queue_poll_failed", error: error.message }));
  } finally {
    queuePolling = false;
  }
};

async function processJob({ jobId, userId, filePath, sessionId, spendEventKey }) {
  const jobKey = `resume-job:${jobId}`;
  let extractionMethod = "unknown";
  try {
    await redis.hset(jobKey, "status", "processing", "updatedAt", new Date().toISOString());
    const extraction = await extractText(filePath);
    const resumeText = extraction.text;
    extractionMethod = extraction.extractionMethod;
    const resumeData = JSON.parse(await resumeAgent(resumeText));
    let resume = await Resume.findOne({ userId });
    if (resume) {
      Object.assign(resume, { ...resumeData, extractedText: resumeText });
      await resume.save();
    } else {
      resume = await Resume.create({ userId, extractedText: resumeText, ...resumeData });
    }
    await redis.set(`resume:${userId}`, JSON.stringify(resume));
    const user = await User.findById(userId).select("interviewCoin name email timezone");
    if (user && sessionId) await redis.set(`session:${sessionId}`, JSON.stringify({ userId: user._id, name: user.name, email: user.email, interviewCoin: user.interviewCoin }), "EX", 60 * 60 * 24 * 7);
    const result = { resumeId: String(resume._id), score: resume.score, extractionMethod };
    await redis.hset(jobKey, "status", "completed", "extractionMethod", extractionMethod, "result", JSON.stringify(result), "updatedAt", new Date().toISOString());
    console.info(JSON.stringify({ requestId: jobId, service: "resume", event: "job_completed", extractionMethod, resumeId: result.resumeId, score: result.score }));
    await publishSafely("resume.scored", {
      eventId: `resume.scored:${jobId}`,
      userId: String(userId),
      timezone: user?.timezone,
      module: "resume",
      result: { score: resume.score, weakTopics: resume.weaknesses, missingSkills: resume.missingSkills, resumeId: String(resume._id), extractionMethod },
    }, { service: "resume", requestId: jobId });
    recordJobOutcome("resume-analysis", "completed");
  } catch (error) {
    extractionMethod = error.extractionMethod || extractionMethod;
    console.error(JSON.stringify({ requestId: jobId, service: "resume", event: "job_failed", extractionMethod, error: error.message }));
    const user = await refundCoinsWithLedger({ User, Ledger: CreditLedger, userId, action: "resume-scorer", eventKey: `refund:${spendEventKey}`, chargeEventKey: spendEventKey }).catch(() => null);
    if (user && sessionId) await redis.set(`session:${sessionId}`, JSON.stringify({ userId: user._id, name: user.name, email: user.email, interviewCoin: user.interviewCoin }), "EX", 60 * 60 * 24 * 7).catch(() => {});
    await redis.hset(jobKey, "status", "failed", "extractionMethod", extractionMethod, "message", error.userMessage || "Resume analysis failed; coins were refunded", "updatedAt", new Date().toISOString()).catch(() => {});
    recordJobOutcome("resume-analysis", "failed");
  } finally {
    fs.promises.unlink(filePath).catch(() => {});
    await redis.expire(jobKey, JOB_TTL_SECONDS).catch(() => {});
  }
}

export const enqueueResumeJob = async ({ userId, filePath, sessionId, spendEventKey }) => {
  const jobId = crypto.randomUUID();
  await redis.hset(`resume-job:${jobId}`, "status", "queued", "userId", String(userId), "createdAt", new Date().toISOString());
  await redis.expire(`resume-job:${jobId}`, JOB_TTL_SECONDS);
  await redis.lpush("resume-jobs", JSON.stringify({ jobId, userId, filePath, sessionId, spendEventKey }));
  await refreshQueueDepth();
  await pollRedisQueue();
  return jobId;
};

export const startResumeQueue = () => {
  setInterval(pollRedisQueue, 1000).unref();
  return pollRedisQueue();
};

export const getResumeJob = async (jobId, userId) => {
  const job = await redis.hgetall(`resume-job:${jobId}`);
  if (!job.status || job.userId !== String(userId)) return null;
  const { userId: _userId, ...publicJob } = job;
  return publicJob;
};
