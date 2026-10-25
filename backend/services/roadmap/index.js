import { dependencyHealth } from "../../shared/utils/health.js"
import { requestLogger } from "../../shared/middleware/requestLogger.js"
import { installPrometheusMetrics } from "../../shared/observability/prometheus.js";
import express from "express"
import dotenv from "dotenv"
import cookieParser from "cookie-parser"
import { connectDB } from "./configs/db.js"
import roadmapRouter from "./routes/roadmap.route.js"
import { drainRoadmapBacklog, startInterviewEventWorker, stopInterviewEventWorker } from "./services/interviewEventWorker.js"
dotenv.config()

const app = express()
app.use(requestLogger("roadmap"))
installPrometheusMetrics(app, "roadmap");
app.use(express.json())
app.use(cookieParser())

const PORT = process.env.PORT || 6004

app.get("/health", (_req, res) => dependencyHealth("roadmap", res));
app.post("/internal/events/drain", async (_req, res) => {
    try { return res.json({ success: true, processed: await drainRoadmapBacklog() }); }
    catch (error) {
        console.error(JSON.stringify({ service: "roadmap", event: "scheduled_drain_failed", error: error.message }));
        return res.status(503).json({ success: false, message: "Could not drain event backlog" });
    }
});

app.use("/", roadmapRouter);

const startServer = async () => {
    try {
        await connectDB();
        await startInterviewEventWorker();

        const server = app.listen(PORT, "0.0.0.0", () => {
            console.log(`Roadmap-service Started on ${PORT}`);
        });

        // Graceful shutdown
        const shutdown = (signal) => {
            console.log(`\n${signal} received – shutting down roadmap service gracefully`);
            stopInterviewEventWorker();
            server.close(() => {
                console.log("Roadmap HTTP server closed");
                process.exit(0);
            });
            setTimeout(() => process.exit(1), 10_000);
        };
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));
    } catch (error) {
        console.error("Failed to start Roadmap service:", error);
        process.exit(1);
    }
};

startServer();
