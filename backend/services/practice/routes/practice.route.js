import express from "express";
import { getQuiz, submitQuiz } from "../controllers/quiz.controller.js";
import { isAuth } from "../middleware/isAuth.js";

const router = express.Router();
router.get("/quiz", isAuth, getQuiz);
router.post("/quiz/submit", isAuth, submitQuiz);
export default router;
