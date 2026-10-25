import express from "express";
import { getResume, uploadResume } from "../controllers/resume.controller.js";
import { getResumeJob } from "../services/resumeJobs.js";
import { upload } from "../middleware/multer.js";
import { isAuth, chargeCoins, deductCoins } from "../middleware/isAuth.js";

const resumeRouter = express.Router();

resumeRouter.post("/upload", isAuth, chargeCoins("upload"), upload.single("resume"), deductCoins, uploadResume);
resumeRouter.get("/jobs/:jobId", isAuth, async (req, res) => {
  try {
    const job = await getResumeJob(req.params.jobId, req.user.userId);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    return res.json({ success: true, job });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});
resumeRouter.get("/get-resume", isAuth, getResume);

export default resumeRouter;
