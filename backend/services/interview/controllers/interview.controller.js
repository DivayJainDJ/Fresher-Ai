import redis from "../../../shared/redis/redis.js";
import crypto from "node:crypto";
import graph from "../graph/graph.js";
import Interview from "../models/interview.model.js";
import { refundCoins, chargeCoins } from "../middleware/isAuth.js";
import { z } from "zod";
import { publishSafely } from "../../../shared/events/bus.js";
import BehavioralQuestion, { BEHAVIORAL_CATEGORIES } from "../models/behavioralQuestion.model.js";
import { streamFeedbackAgent } from "../agents/feedback.agent.js";
import { summaryAgent } from "../agents/summary.agent.js";
import { recordLlmTimingSample } from "../../../shared/utils/llmMetrics.js";

const startInterviewSchema = z.object({
    type: z.enum(["technical", "hr", "behavioral"]),
    role: z.string().trim().min(1).max(120),
    useResume: z.boolean().default(false),
    resume: z.record(z.string(), z.unknown()).default({}),
    category: z.enum(BEHAVIORAL_CATEGORIES).optional(),
    idempotencyKey: z.string().min(8).max(128).optional(),
}).strict();
const answerSchema = z.object({
    interviewId: z.string().min(1),
    answer: z.string().trim().min(1).max(12000),
    deliveryMetrics: z.object({
        wordsPerMinute: z.number().finite().min(0).max(2000),
        fillerCount: z.number().int().min(0).max(1000),
        fillerWords: z.array(z.enum(["um", "uh", "like", "you know", "basically", "actually"])).max(1000),
        longestPauseMs: z.number().int().min(0).max(3_600_000),
        answerLength: z.number().int().min(0).max(12000),
    }).optional(),
}).strict();


export const startInterview = async (req, res) => {
    try {
        const userId = req.user?.userId || req.headers["x-user-id"]
        const parsed = startInterviewSchema.safeParse(req.body);
        if (!parsed.success) {
            await refundCoins(req);
            return res.status(400).json({ success: false, message: "Valid interview type, role, and resume data are required" });
        }
        const { type, role, useResume, resume } = parsed.data;
        const category = parsed.data.category;
        const action = type === "behavioral" ? "behavioral-session" : "start-interview";
        await new Promise((resolve, reject) => chargeCoins(action)(req, res, (error) => error ? reject(error) : resolve()));
        if (res.headersSent) return;
        if (!req.coinCharge) return res.status(402).json({ success: false, message: "Interview session charge was not applied" });
        if (req.coinCharge.alreadyProcessed && req.coinCharge.action === "behavioral-session") return res.status(409).json({ success: false, message: "This session key was already charged. Start a new session with a fresh idempotencyKey." });

        const result = await graph.invoke({
            action: "start",
            role,
            type,
            useResume,
            resume,
            category,
        })

        let questions = result.questions;
        if (type === "behavioral") {
            const bankQuestions = await BehavioralQuestion.aggregate([
                { $match: { active: true, ...(category ? { category } : {}) } },
                { $sample: { size: 6 } },
                { $project: { question: 1, category: 1 } },
            ]);
            if (bankQuestions.length) questions = bankQuestions.map((item, index) => ({ question: item.question, category: item.category, difficulty: index < 2 ? "easy" : index < 4 ? "medium" : "hard", timer: 90 }));
        }

        if (!questions || questions.length === 0) {
            await refundCoins(req);
            return res.status(500).json({
                success: false,
                message: "Failed to generate interview questions",
            });
        }

        const interview = await Interview.create({
            userId,

            type,

            role,

            useResume,

            questions,

            currentQuestion: 0,

            status: "in-progress",
        })

        res.setHeader("X-Interview-Coins", String(req.user.interviewCoin));

        await redis.del(`interviews:${userId}`)

        return res.status(200).json({
            success: true,

            interviewId: interview._id,

            currentQuestion: 0,

            totalQuestions: interview.questions.length,

            question: interview.questions[0],
        })
    } catch (error) {

        await refundCoins(req).catch((refundError) => console.error("coin refund failed", refundError));

        console.log(error)

        return res.status(500).json({

            success: false,

            message: error.message,

        });
    }
}



const streamAnswerSchema = answerSchema.extend({
    idempotencyKey: z.string().regex(/^[a-zA-Z0-9:_-]{8,128}$/).optional(),
}).strict();

const streamEvent = (res, event, data) => {
    if (res.destroyed || res.writableEnded) return false;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
};

const streamAnswerFeedbackHandler = async (req, res) => {
    const streamStartedAt = Date.now();
    req.sseTokenProduced = false;
    req.sseRefunded = false;
    const parsed = streamAnswerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: "Interview ID and answer are required" });

    const userId = req.user?.userId || req.headers["x-user-id"];
    const { interviewId, answer, deliveryMetrics } = parsed.data;
    const interview = await Interview.findOne({ _id: interviewId, userId });
    if (!interview) return res.status(404).json({ success: false, message: "Interview not found" });
    if (interview.status === "completed") return res.status(400).json({ success: false, message: "Interview already completed" });

    const index = interview.currentQuestion;
    const currentQuestion = interview.questions[index];
    if (!currentQuestion) return res.status(400).json({ success: false, message: "Invalid question index" });

    const isBehavioral = interview.type === "behavioral";
    if (!isBehavioral) {
        await new Promise((resolve, reject) => chargeCoins("interview-feedback")(req, res, (error) => error ? reject(error) : resolve()));
        if (res.headersSent) return;
        if (!req.coinCharge) return res.status(500).json({ success: false, message: "Interview feedback charge was not applied" });
    }
    if (req.sseAbortController.signal.aborted) {
        if (req.coinCharge && !req.sseRefunded) {
            req.sseRefunded = true;
            await refundCoins(req);
        }
        return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Content-Encoding", "identity");
    res.flushHeaders?.();

    const abortController = req.sseAbortController;
    let tokenProduced = false;
    const heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) res.write(": heartbeat\n\n");
    }, 15_000);

    try {
        const feedbackResult = await streamFeedbackAgent({
            question: currentQuestion.question,
            answer,
            difficulty: currentQuestion.difficulty,
            type: interview.type,
            category: currentQuestion.category,
            deliveryMetrics: deliveryMetrics || currentQuestion.deliveryMetrics,
        }, async (token) => {
            if (!tokenProduced) {
                tokenProduced = true;
                req.sseTokenProduced = true;
                if (!streamEvent(res, "token", { token })) throw new Error("Client disconnected");
                void recordLlmTimingSample("streamTimeToFirstToken", Date.now() - streamStartedAt);
                return;
            }
            if (!streamEvent(res, "token", { token })) throw new Error("Client disconnected");
        }, { signal: abortController.signal });

        currentQuestion.userAnswer = answer;
        if (deliveryMetrics) currentQuestion.deliveryMetrics = deliveryMetrics;
        if (parsed.data.idempotencyKey) currentQuestion.feedbackRequestKey = parsed.data.idempotencyKey;
        currentQuestion.feedback = feedbackResult.feedback;
        interview.currentQuestion += 1;
        const completed = interview.currentQuestion >= interview.questions.length;
        let responseData;

        if (completed) {
            const report = await summaryAgent({ role: interview.role, type: interview.type, questions: interview.questions }, { signal: abortController.signal });
            interview.status = "completed";
            interview.overallScore = report.overallScore;
            interview.summary = report.summary;
            interview.strengths = report.strengths;
            interview.weaknesses = report.weaknesses;
            interview.recommendations = report.recommendations;
            await interview.save();
            await redis.del(`interviews:${userId}`);
            await publishSafely(isBehavioral ? "behavioral.completed" : "interview.completed", {
                eventId: `${isBehavioral ? "behavioral.completed" : "interview.completed"}:${interview._id}`,
                userId: String(userId),
                timezone: req.headers["x-timezone"],
                module: isBehavioral ? "behavioral" : "interview",
                result: { score: interview.overallScore, weakTopics: interview.weaknesses, interviewId: String(interview._id), role: interview.role },
            }, { service: "interview", requestId: req.requestId || req.headers["x-request-id"] });
            responseData = { success: true, completed: true, interview, feedback: feedbackResult.feedback };
        } else {
            await interview.save();
            await redis.del(`interviews:${userId}`);
            responseData = {
                success: true,
                completed: false,
                currentQuestion: interview.currentQuestion,
                question: interview.questions[interview.currentQuestion],
                feedback: feedbackResult.feedback,
            };
        }
        void recordLlmTimingSample("streamFullResponse", Date.now() - streamStartedAt);
        if (parsed.data.idempotencyKey) {
            try {
                await redis.set(`stream-feedback:result:${userId}:${parsed.data.idempotencyKey}`, JSON.stringify({ content: feedbackResult.content, result: responseData }), "EX", 6 * 60 * 60);
            } catch (error) {
                console.warn("stream feedback idempotency cache write failed", error.message);
            }
        }
        streamEvent(res, "done", responseData);
        res.end();
    } catch (error) {
        if (!tokenProduced && req.coinCharge && !req.sseRefunded) {
            req.sseRefunded = true;
            await refundCoins(req).catch((refundError) => console.error("stream feedback refund failed", refundError));
        }
        if (!abortController.signal.aborted && !res.destroyed && !res.writableEnded) {
            const message = tokenProduced
                ? "Feedback stream stopped before completion"
                : req.coinCharge ? "Feedback could not be generated. Your coins were refunded." : "Feedback could not be generated. Please try again.";
            streamEvent(res, "error", { message });
            res.end();
        }
        if (!abortController.signal.aborted) console.error("interview feedback stream failed", error);
    } finally {
        clearInterval(heartbeat);
    }
};

export const streamAnswerFeedback = async (req, res) => {
    let lockKey;
    let lockToken;
    const abortController = new AbortController();
    const abortOnDisconnect = () => {
        if (!res.writableEnded && !abortController.signal.aborted) abortController.abort(new Error("Client disconnected"));
    };
    req.sseAbortController = abortController;
    req.once("aborted", abortOnDisconnect);
    res.once("close", abortOnDisconnect);
    try {
        const parsed = streamAnswerSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ success: false, message: "Interview ID and answer are required" });
        const userId = req.user?.userId || req.headers["x-user-id"];
        const idempotencyKey = parsed.data.idempotencyKey;
        if (idempotencyKey) {
            const resultKey = `stream-feedback:result:${userId}:${idempotencyKey}`;
            const cached = await redis.get(resultKey);
            if (!cached && !abortController.signal.aborted) {
                const savedInterview = await Interview.findOne({ userId, "questions.feedbackRequestKey": idempotencyKey });
                const savedQuestion = savedInterview?.questions.find((item) => item.feedbackRequestKey === idempotencyKey);
                if (savedQuestion) {
                    const result = savedInterview.status === "completed"
                        ? { success: true, completed: true, interview: savedInterview, feedback: savedQuestion.feedback }
                        : { success: true, completed: false, currentQuestion: savedInterview.currentQuestion, question: savedInterview.questions[savedInterview.currentQuestion], feedback: savedQuestion.feedback };
                    res.status(200);
                    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
                    res.setHeader("Cache-Control", "no-cache, no-transform");
                    res.setHeader("Connection", "keep-alive");
                    res.setHeader("X-Accel-Buffering", "no");
                    res.setHeader("Content-Encoding", "identity");
                    res.flushHeaders?.();
                    streamEvent(res, "token", { token: JSON.stringify(savedQuestion.feedback) });
                    streamEvent(res, "done", result);
                    return res.end();
                }
            }
            if (cached && !abortController.signal.aborted) {
                const { content, result } = JSON.parse(cached);
                res.status(200);
                res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
                res.setHeader("Cache-Control", "no-cache, no-transform");
                res.setHeader("Connection", "keep-alive");
                res.setHeader("X-Accel-Buffering", "no");
                res.setHeader("Content-Encoding", "identity");
                res.flushHeaders?.();
                streamEvent(res, "token", { token: content });
                streamEvent(res, "done", result);
                return res.end();
            }
            lockKey = `stream-feedback:lock:${userId}:${idempotencyKey}`;
            lockToken = crypto.randomUUID();
            const acquired = await redis.set(lockKey, lockToken, "EX", 180, "NX");
            if (!acquired) return res.status(409).json({ success: false, message: "This feedback request is already processing. Retry with the same request." });
        }
        return await streamAnswerFeedbackHandler(req, res);
    } catch (error) {
        if (!req.sseTokenProduced && req.coinCharge && !req.sseRefunded) {
            req.sseRefunded = true;
            await refundCoins(req).catch((refundError) => console.error("stream feedback refund failed", refundError));
        }
        if (!res.headersSent) return res.status(500).json({ success: false, message: "Unable to start feedback stream" });
        if (!res.destroyed && !res.writableEnded) {
            try {
                streamEvent(res, "error", { message: "Feedback stream failed" });
                res.end();
            } catch { /* The client has already disconnected. */ }
        }
        console.error("interview feedback stream setup failed", error);
    } finally {
        req.removeListener("aborted", abortOnDisconnect);
        res.removeListener("close", abortOnDisconnect);
        delete req.sseAbortController;
        if (lockKey && lockToken) {
            try {
                await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", 1, lockKey, lockToken);
            } catch (error) {
                console.error("stream feedback lock release failed", error.message);
            }
        }
    }
};

export const submitAnswer = async (req, res) => {
    const requestStartedAt = Date.now();
    try {
        const userId = req.user?.userId || req.headers["x-user-id"]
        const parsed = answerSchema.safeParse(req.body);
        if (!parsed.success) {
            await refundCoins(req);
            return res.status(400).json({ success: false, message: "Interview ID and answer are required" });
        }
        const { interviewId, answer } = parsed.data

        const interview = await Interview.findOne({
            _id: interviewId,
            userId
        })

        if (!interview) {
            await refundCoins(req);
            return res.status(404).json({
                success: false,
                message: "Interview not found",
            });
        }
        const isBehavioral = interview.type === "behavioral";
        if (!isBehavioral) {
            await new Promise((resolve, reject) => chargeCoins("interview-feedback")(req, res, (error) => error ? reject(error) : resolve()));
        }
        if (res.headersSent) return;
        if (!req.coinCharge && !isBehavioral) {
            return res.status(500).json({ success: false, message: "Interview feedback charge was not applied" });
        }

        if (interview.status === "completed") {
            await refundCoins(req);
            return res.status(400).json({
                success: false,
                message: "Interview already completed",
            });
        }

        const index = interview.currentQuestion
        const currentQuestion = interview.questions[index]

        if (!currentQuestion) {
            await refundCoins(req);
            return res.status(400).json({
                success: false,
                message: "Invalid question index",
            });
        }

        currentQuestion.userAnswer = answer;
        if (parsed.data.deliveryMetrics) currentQuestion.deliveryMetrics = parsed.data.deliveryMetrics;

        const completed = interview.currentQuestion + 1 >=
            interview.questions.length;

        const result = await graph.invoke({
            action: "feedback",

            question: currentQuestion.question,

            answer,

            difficulty: currentQuestion.difficulty,

            completed,

            role: interview.role,

            type: interview.type,
            category: currentQuestion.category,
            deliveryMetrics: currentQuestion.deliveryMetrics,

            questions: interview.questions,
        })


        currentQuestion.feedback = result.feedback;

        interview.currentQuestion++;


        if (completed) {

            interview.status = "completed";

            interview.overallScore =
                result.report.overallScore;

            interview.summary =
                result.report.summary;

            interview.strengths =
                result.report.strengths;

            interview.weaknesses =
                result.report.weaknesses;

            interview.recommendations =
                result.report.recommendations;

            await interview.save()

            await redis.del(`interviews:${userId}`)

            await publishSafely(isBehavioral ? "behavioral.completed" : "interview.completed", {
                eventId: `${isBehavioral ? "behavioral.completed" : "interview.completed"}:${interview._id}`,
                userId: String(userId),
                timezone: req.headers["x-timezone"],
                module: isBehavioral ? "behavioral" : "interview",
                result: {
                    score: interview.overallScore,
                    weakTopics: interview.weaknesses,
                    interviewId: String(interview._id),
                    role: interview.role,
                },
            }, { service: "interview", requestId: req.requestId || req.headers["x-request-id"] });

            void recordLlmTimingSample("nonStreamingFullResponse", Date.now() - requestStartedAt);
            return res.status(200).json({

                success: true,

                completed: true,

                interview,

                feedback: result.feedback,

            });

        }


        await interview.save()

        await redis.del(`interviews:${userId}`)

        void recordLlmTimingSample("nonStreamingFullResponse", Date.now() - requestStartedAt);
        return res.status(200).json({

            success: true,

            completed: false,

            currentQuestion: interview.currentQuestion,

            question:
                interview.questions[
                interview.currentQuestion
                ],

            feedback: result.feedback,

        });

    } catch (error) {

        await refundCoins(req).catch((refundError) => console.error("coin refund failed", refundError));

        console.log(error);

        return res.status(500).json({

            success: false,

            message: error.message,

        });

    }
}


export const getInterview = async (req, res) => {
    try {
        const userId = req.headers["x-user-id"]
        const { id } = req.params

        const interview = await Interview.findOne({
            _id: id,
            userId
        })
        if (!interview) {
            return res.status(404).json({
                success: false,
                message: "Interview not found",
            });
        }

        return res.status(200).json({
            success: true,
            interview,
        });
    } catch (error) {
        console.log(error);

        return res.status(500).json({

            success: false,

            message: error.message,

        });
    }
}


export const getAllInterviews = async (req, res) => {
    try {
        const userId = req.headers["x-user-id"]

        const cache = await redis.get(`interviews:${userId}`)

        if (cache) {

            return res.status(200).json(JSON.parse(cache))
        }

        const interviews = await Interview.find({ userId }).sort({ createdAt: -1 })

        const completed = interviews.filter((item) => item.status === "completed")

        const totalQuestions = interviews.reduce((sum, item) => sum + item.questions.length, 0)

        const averageScore = completed.length > 0 ? Number(
            (completed.reduce((sum, item) => sum + item.overallScore, 0)) / completed.length).toFixed(1) : 0


        const stats = {
            totalInterviews: interviews.length,
            totalQuestions,
            completed: completed.length,
            averageScore
        }


        const getAverageData = (list) => {
            if (!list.length) {
                return [
                    { skill: "Correctness", score: 0 },
                    { skill: "Clarity", score: 0 },
                    { skill: "Relevance", score: 0 },
                    { skill: "Detail", score: 0 },
                    { skill: "Efficiency", score: 0 },
                    { skill: "Communication", score: 0 },
                    { skill: "Problem solving", score: 0 },
                    { skill: "Creativity", score: 0 },
                ];
            }

            const total = {
                correctness: 0,
                clarity: 0,
                relevance: 0,
                detail: 0,
                efficiency: 0,
                communication: 0,
                problemSolving: 0,
                creativity: 0,
            }

            list.forEach((interview) => {
                interview.questions.forEach((q) => {
                    total.correctness += q.feedback?.correctness || 0;
                    total.clarity += q.feedback?.clarity || 0;
                    total.relevance += q.feedback?.relevance || 0;
                    total.detail += q.feedback?.detail || 0;
                    total.efficiency += q.feedback?.efficiency || 0;
                    total.communication += q.feedback?.communication || 0;
                    total.problemSolving += q.feedback?.problemSolving || 0;
                    total.creativity += q.feedback?.creativity || 0;

                })
            })

            const count = list.reduce((sum, item) => sum + item.questions.length, 0)

            if (count === 0) {
                return [
                    { skill: "Correctness", score: 0 },
                    { skill: "Clarity", score: 0 },
                    { skill: "Relevance", score: 0 },
                    { skill: "Detail", score: 0 },
                    { skill: "Efficiency", score: 0 },
                    { skill: "Communication", score: 0 },
                    { skill: "Problem solving", score: 0 },
                    { skill: "Creativity", score: 0 },
                ];
            }


            return [
                {
                    skill: "Correctness",
                    score: Math.round(total.correctness / count)
                },
                {
                    skill: "Clarity",
                    score: Math.round(total.clarity / count),
                },

                {
                    skill: "Relevance",
                    score: Math.round(total.relevance / count),
                },

                {
                    skill: "Detail",
                    score: Math.round(total.detail / count),
                },

                {
                    skill: "Efficiency",
                    score: Math.round(total.efficiency / count),
                },

                {
                    skill: "Communication",
                    score: Math.round(total.communication / count),
                },

                {
                    skill: "Problem solving",
                    score: Math.round(total.problemSolving / count),
                },

                {
                    skill: "Creativity",
                    score: Math.round(total.creativity / count),
                },


            ]
        }

            const technicalInterviews = completed.filter((item) => item.type === "technical")

            const HrInterviews = completed.filter((item) => item.type === "hr")


            const technicalData = getAverageData(technicalInterviews)

            const hrData = getAverageData(HrInterviews)

            const technicalCount = technicalInterviews.length

            const hrCount = HrInterviews.length

            const payload = {
                success: true,
                interviews,
                stats,
                technicalData,
                hrData,
                technicalCount,
                hrCount,
            }

            await redis.set(`interviews:${userId}`, JSON.stringify(payload), "EX", 600)


            return res.status(200).json(payload);




    } catch (error) {
        console.log(error)
        return res.status(500).json({

            success: false,

            message: error.message,

        });
    }
}

export const getBehavioralQuestions = async (req, res) => {
    const parsed = z.object({ category: z.enum(BEHAVIORAL_CATEGORIES).optional() }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid behavioral question category", categories: BEHAVIORAL_CATEGORIES });
    try {
        const filter = { active: true, ...(parsed.data.category ? { category: parsed.data.category } : {}) };
        const questions = await BehavioralQuestion.find(filter).select("question category").sort({ category: 1, question: 1 }).lean();
        return res.json({ success: true, categories: BEHAVIORAL_CATEGORIES, questions });
    } catch (error) {
        console.error(JSON.stringify({ service: "interview", event: "behavioral_questions_failed", requestId: req.requestId || null, error: error.message }));
        return res.status(503).json({ message: "Behavioral questions are temporarily unavailable" });
    }
};

const starBuilderSchema = z.object({ roughStory: z.string().trim().min(1).max(6000), category: z.enum(BEHAVIORAL_CATEGORIES).optional() }).strict();
export const buildStarStory = async (req, res) => {
    const parsed = starBuilderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Provide a rough story of up to 6,000 characters", errors: parsed.error.flatten() });
    try {
        const result = await graph.invoke({
            action: "feedback", type: "behavioral", category: parsed.data.category || "teamwork",
            question: "Restructure this rough story into a concise STAR answer. Preserve facts and mark missing details with placeholders.",
            answer: parsed.data.roughStory, difficulty: "medium", completed: false,
        });
        return res.json({ success: true, ...result.feedback });
    } catch (error) {
        console.error(JSON.stringify({ service: "interview", event: "star_story_builder_failed", requestId: req.requestId || null, error: error.message }));
        return res.status(503).json({ message: "STAR story builder is temporarily unavailable" });
    }
};


