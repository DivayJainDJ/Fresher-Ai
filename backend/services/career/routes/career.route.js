import express from "express";
import { postCoverLetter, postMatch } from "../controllers/career.controller.js";
import { isAuth } from "../middleware/isAuth.js";

const router = express.Router();
router.post("/match", isAuth, postMatch);
router.post("/cover-letter", isAuth, postCoverLetter);
export default router;
