import express from "express";
import { getDueMistakes, getLeaderboard, getMyProgress, getReadinessDashboard, reviewMistake, updateProgressSettings } from "../controllers/progress.controller.js";
import { isAuth } from "../middleware/isAuth.js";

const router = express.Router();
router.get("/dashboard", isAuth, getReadinessDashboard);
router.get("/me", isAuth, getMyProgress);
router.get("/mistakes/due", isAuth, getDueMistakes);
router.post("/mistakes/:id/review", isAuth, reviewMistake);
router.get("/leaderboard", isAuth, getLeaderboard);
router.patch("/settings", isAuth, updateProgressSettings);
export default router;
