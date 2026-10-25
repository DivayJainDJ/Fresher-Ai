import express from "express"
import { generateRoadmap, getAllRoadmap, getRoadmapbyId } from "../controllers/roadmap.controller.js"
import { isAuth, chargeCoins } from "../middleware/isAuth.js"

const roadmapRouter = express.Router()

roadmapRouter.post("/generate" , isAuth, chargeCoins("roadmap-builder"), generateRoadmap)

roadmapRouter.get("/all" , isAuth, getAllRoadmap )

roadmapRouter.get("/:id", isAuth, getRoadmapbyId)

export default roadmapRouter
