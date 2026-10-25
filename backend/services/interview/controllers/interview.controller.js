import redis from "../../../shared/redis/redis.js";
import graph from "../graph/graph.js";
import Interview from "../models/interview.model.js";
import { refundCoins, chargeCoins } from "../middleware/isAuth.js";
import { z } from "zod";
import { publishSafely } from "../../../shared/events/bus.js";
import BehavioralQuestion, { BEHAVIORAL_CATEGORIES } from "../models/behavioralQuestion.model.js";

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


export const submitAnswer = async (req, res) => {
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
                module: isBehavioral ? "behavioral" : "interview",
                result: {
                    score: interview.overallScore,
                    weakTopics: interview.weaknesses,
                    interviewId: String(interview._id),
                    role: interview.role,
                },
            }, { service: "interview", requestId: req.requestId || req.headers["x-request-id"] });

            return res.status(200).json({

                success: true,

                completed: true,

                interview,

                feedback: result.feedback,

            });

        }


        await interview.save()

        await redis.del(`interviews:${userId}`)

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


