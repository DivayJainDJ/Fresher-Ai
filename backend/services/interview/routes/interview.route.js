import express from "express"
import { getAllInterviews, getInterview, startInterview, submitAnswer } from "../controllers/interview.controller.js"
import { isAuth, chargeCoins } from "../middleware/isAuth.js"

const interviewRouter = express.Router()

interviewRouter.post("/start", isAuth, chargeCoins("start-interview"), startInterview)

interviewRouter.post("/answer", isAuth, chargeCoins("interview-feedback"), submitAnswer)

interviewRouter.get("/all", isAuth, getAllInterviews)

interviewRouter.get("/:id", isAuth, getInterview)


export default interviewRouter
