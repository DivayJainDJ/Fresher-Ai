import mongoose from "mongoose";


const feedbackSchema = new mongoose.Schema(
    {
        score: {
            type: Number,
            default: 0,
        },

        correctness: {
            type: Number,
            default: 0,
        },

        clarity: {
            type: Number,
            default: 0,
        },

        relevance: {
            type: Number,
            default: 0,
        },

        detail: {
            type: Number,
            default: 0,
        },

        efficiency: {
            type: Number,
            default: 0,
        },

        communication: {
            type: Number,
            default: 0,
        },

        problemSolving: {
            type: Number,
            default: 0,
        },

        creativity: {
            type: Number,
            default: 0,
        },

        feedback: {
            type: String,
            default: "",
        },

        improvements: {
            type: [String],
            default: [],
        },

        starScore: {
            type: new mongoose.Schema({
                situation: { type: Number, min: 0, max: 5 },
                task: { type: Number, min: 0, max: 5 },
                action: { type: Number, min: 0, max: 5 },
                result: { type: Number, min: 0, max: 5 },
            }, { _id: false }),
        },
        clarity: { type: Number, min: 0, max: 100 },
        confidence: { type: Number, min: 0, max: 100 },
        improvedAnswer: { type: String, default: "" },
        nextSteps: { type: [String], default: [] },
    },
    { _id: false }
);

const questionSchema = new mongoose.Schema(
    {
        question: {
            type: String,
            required: true,
        },
        category: { type: String, enum: ["introduction", "teamwork", "conflict", "failure", "leadership", "salary"] },
        userAnswer: {
            type: String,
            default: "",
        },

        difficulty: {
            type: String,
            enum: ["easy", "medium", "hard"],
            default: "easy",
        },

        timer: {
            type: Number,
            default: 60,
        },

        feedback: {
            type: feedbackSchema,
            default: () => ({}),
        },
        feedbackRequestKey: { type: String, default: "" },
        deliveryMetrics: {
            wordsPerMinute: { type: Number, min: 0, max: 2000 },
            fillerCount: { type: Number, min: 0, max: 1000 },
            fillerWords: { type: [String], default: [] },
            longestPauseMs: { type: Number, min: 0, max: 3_600_000 },
            answerLength: { type: Number, min: 0, max: 12000 },
        },
    },
    { _id: false }
);

const interviewSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },

        type: {
            type: String,
            enum: ["hr", "technical", "behavioral"],
            required: true,
        },

        role: {
            type: String,
            required: true,
        },
        useResume: {
            type: Boolean,
            default: false,
        },

        currentQuestion: {
            type: Number,
            default: 0,
        },

        questions: {
            type: [questionSchema],
            default: [],
        },

        overallScore: {
            type: Number,
            default: 0,
        },

        strengths: {
            type: [String],
            default: [],
        },

        weaknesses: {
            type: [String],
            default: [],
        },

        recommendations: {
            type: [String],
            default: [],
        },

        summary: {
            type: String,
            default: "",
        },

        status: {
            type: String,
            enum: ["in-progress", "completed"],
            default: "in-progress",
        },
    },
    {
        timestamps: true,
    }
);

const Interview = mongoose.model("Interview" , interviewSchema)

export default Interview
