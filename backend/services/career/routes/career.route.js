import express from "express";
import { createApplication, deleteApplication, listApplications, postCoverLetter, postMatch, updateApplication } from "../controllers/career.controller.js";
import { isAuth } from "../middleware/isAuth.js";

const router = express.Router();
router.get("/applications", isAuth, listApplications);
router.post("/applications", isAuth, createApplication);
router.patch("/applications/:id", isAuth, updateApplication);
router.delete("/applications/:id", isAuth, deleteApplication);
router.post("/match", isAuth, postMatch);
router.post("/cover-letter", isAuth, postCoverLetter);
export default router;
