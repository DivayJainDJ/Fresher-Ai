import express from "express"
import { getAllInterviews, getInterview, startInterview, submitAnswer, getBehavioralQuestions, buildStarStory, streamAnswerFeedback } from "../controllers/interview.controller.js"
import { isAuth, chargeCoins } from "../middleware/isAuth.js"
import { reviewCode, validateCodeReview } from "../controllers/codeReview.controller.js"
import { getDesignRound, listDesignPrompts, startDesignRound, submitDesignStep } from "../controllers/design.controller.js"

const interviewRouter = express.Router()

interviewRouter.get("/behavioral/questions", isAuth, getBehavioralQuestions)
interviewRouter.post("/behavioral/star-builder", isAuth, buildStarStory)
interviewRouter.get("/design/prompts", isAuth, listDesignPrompts)
interviewRouter.post("/design/start", isAuth, startDesignRound)
interviewRouter.post("/design/:id/answer", isAuth, submitDesignStep)
interviewRouter.get("/design/:id", isAuth, getDesignRound)
interviewRouter.post("/start", isAuth, startInterview)

interviewRouter.post("/feedback/stream", isAuth, streamAnswerFeedback)
interviewRouter.post("/answer", isAuth, submitAnswer)
interviewRouter.post("/code-review", isAuth, validateCodeReview, chargeCoins("code-review"), reviewCode)

interviewRouter.get("/all", isAuth, getAllInterviews)

interviewRouter.get("/:id", isAuth, getInterview)


export default interviewRouter
