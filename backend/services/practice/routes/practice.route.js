import express from "express";
import { getQuiz, submitQuiz } from "../controllers/quiz.controller.js";
import { isAuth } from "../middleware/isAuth.js";
import { listSqlProblems, submitSqlAttempt } from "../controllers/sql.controller.js";

const router = express.Router();
router.get("/quiz", isAuth, getQuiz);
router.post("/quiz/submit", isAuth, submitQuiz);
router.get("/sql/problems", isAuth, listSqlProblems);
router.post("/sql/problems/:problemId/attempt", isAuth, submitSqlAttempt);
export default router;
