import express from "express";
import { getMyProgress, getReadinessDashboard } from "../controllers/progress.controller.js";
import { isAuth } from "../middleware/isAuth.js";

const router = express.Router();
router.get("/dashboard", isAuth, getReadinessDashboard);
router.get("/me", isAuth, getMyProgress);
export default router;
