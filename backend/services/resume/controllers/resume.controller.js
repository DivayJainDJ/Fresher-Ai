

// pdf  ---->  pdf Storage  ---> text ---> llm ---> agent ---> promt ---> data ---> save mongoDb ---> redis -->pdf delete ---> resume data ( score , missing skills , recommen.)

import redis from "../../../shared/redis/redis.js";
import Resume from "../models/resume.model.js";
import { enqueueResumeJob } from "../services/resumeJobs.js";
import { refundCoins } from "../middleware/isAuth.js";
import fs from "fs"

const removeFileIfExists = (filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

export const uploadResume = async (req,res) => {
    const file = req.file;
    try {
        if(!file){
            return res.status(400).json({
                success:false,
                message:"Resume PDF is required"
            })
        }
        const userId = req.user?.userId || req.headers["x-user-id"];

          if(!userId){
            return res.status(400).json({
                success:false,
                message:"UserId is required"
            })
        }

        const sessionId = req.cookies?.session || req.headers["x-session-id"];
        const jobId = await enqueueResumeJob({ userId, filePath: file.path, sessionId, spendEventKey: req.coinCharge?.eventKey });
        res.setHeader("X-Interview-Coins", String(req.user.interviewCoin));
        return res.status(202).json({ success: true, message: "Resume analysis queued", jobId, status: "queued" });


    } catch (error) {
        console.log(error)
        await refundCoins(req).catch((refundError) => console.error("coin refund failed", refundError));


        if(file){
            removeFileIfExists(file.path);
        }
        return res.status(500).json({
            success:false,
            message:error.message,
        })

    }
}


export const getResume = async (req,res) => {
    try {
        const userId = req.user?.userId || req.headers["x-user-id"];

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "UserId is required",
            });
        }

    const cache = await redis.get(`resume:${userId}`)

    if(cache){
        return res.status(200).json({
            success:true,
            source:"redis",
            data:JSON.parse(cache)
        })
    }
    const resume = await Resume.findOne({userId})

    if(!resume){
        return res.status(404).json({
            success:false,
            message:"resume not found"
        })
    }

    await redis.set(`resume:${userId}`,JSON.stringify(resume));


     return res.status(200).json({
            success:true,
            source:"mongoDb",
            data:resume
        })

    } catch (error) {
        console.log(error)
         return res.status(500).json({
            success:false,
            message:error.message,
        })
    }



}
