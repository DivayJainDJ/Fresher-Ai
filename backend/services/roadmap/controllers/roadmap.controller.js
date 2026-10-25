import redis from "../../../shared/redis/redis.js";
import graph from "../graph/roadmap.graph.js";
import Roadmap from "../models/roadmap.model.js";
import { refundCoins } from "../middleware/isAuth.js";
import { z } from "zod";
import { publishSafely } from "../../../shared/events/bus.js";

const roadmapSchema = z.object({
  role: z.string().trim().min(1).max(120),
  targetPackage: z.string().trim().min(1).max(80),
  useResume: z.boolean().default(false),
  resume: z.record(z.string(), z.unknown()).optional(),
}).strict();



export const generateRoadmap =async (req,res)=> {
    try {
      const parsed = roadmapSchema.safeParse(req.body);
      if (!parsed.success || (parsed.data.useResume && !parsed.data.resume)) {
        await refundCoins(req);
        return res.status(400).json({ success: false, message: "Valid role, target package, and resume data are required." });
      }
      const { role, targetPackage, useResume, resume } = parsed.data;
      const userId = req.user?.userId || req.headers["x-user-id"];

      const result = await graph.invoke({
        role,
      targetPackage,
      useResume,
      resume,
      })

      const roadmap = await Roadmap.create({
        userId,
        ...result.roadmap
      })

      res.setHeader("X-Interview-Coins", String(req.user.interviewCoin));

      await redis.set(`roadmap:${roadmap._id}`,JSON.stringify(roadmap),"EX", 60*60)

      await redis.del(`userRoadmaps:${userId}`)

      await publishSafely("roadmap.generated", {
        eventId: `roadmap.generated:${roadmap._id}`,
        userId: String(userId),
        module: "roadmap",
        result: { roadmapId: String(roadmap._id), topicCount: roadmap.modules.length },
      }, { service: "roadmap", requestId: req.requestId || req.headers["x-request-id"] });

      return res.status(201).json({
      success: true,
      message: "Roadmap generated successfully.",
      data: roadmap,
    });


    } catch (error) {
        await refundCoins(req).catch((refundError) => console.error("coin refund failed", refundError));
        console.log(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
    }
}


export const getAllRoadmap = async (req,res) => {
    try {
        const userId = req.headers["x-user-id"]
        const cache = await redis.get(`userRoadmaps:${userId}`)

        if(cache){
            return res.status(200).json({
        success: true,
        data: JSON.parse(cache),
      })
        }

        const roadmaps = await Roadmap.find({userId}).sort({createdAt: -1})

        await redis.set(`userRoadmaps:${userId}`,JSON.stringify(roadmaps),"EX",60*60)

    return res.json({
      success: true,
      data: roadmaps,
    });
    } catch (error) {
       console.log(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
    }
}

export const getRoadmapbyId = async (req,res) => {
    try {
        const {id} = req.params;
        const userId = req.headers["x-user-id"];

        const cache = await redis.get(`roadmap:${id}`)
        if(cache){
            return res.json({
                success: true,
                fromCache: true,
                data: JSON.parse(cache)
            });

        }

        const roadmap = await Roadmap.findOne({
             _id: id,
            userId:userId
        })

        if(!roadmap){
            return res.status(404).json({
                success: false,
                message: "Roadmap not found"
            });
        }

        await redis.set(`roadmap:${id}`,JSON.stringify(roadmap),"EX", 60*60)

        return res.json({
            success: true,
            fromCache: false,
            data: roadmap
        });
    } catch (error) {
      console.log(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
    }

}
