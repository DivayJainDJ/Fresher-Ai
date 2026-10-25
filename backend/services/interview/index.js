import { dependencyHealth } from "../../shared/utils/health.js"
import { requestLogger } from "../../shared/middleware/requestLogger.js"
import { installPrometheusMetrics } from "../../shared/observability/prometheus.js";
import express from "express"
import dotenv from "dotenv"
import cookieParser from "cookie-parser"
import { connectDB } from "./config/db.js"
import interviewRouter from "./routes/interview.route.js"
import { seedBehavioralQuestions } from "./seeds/behavioralQuestions.js"
dotenv.config()

const app = express()
app.use(requestLogger("interview"))
installPrometheusMetrics(app, "interview");

app.use(express.json())
app.use(cookieParser())

const PORT = process.env.PORT || 6003

app.get("/health", (_req, res) => dependencyHealth("interview", res));

app.get("/", (_req, res) => {
    res.send("Hello from Interview-service");
});


app.use("/", interviewRouter);


const startServer = async () => {
    try {
        await connectDB();
        await seedBehavioralQuestions();

        const server = app.listen(PORT, "0.0.0.0", () => {
            console.log(`Interview-service Started on ${PORT}`);
        });

        // Graceful shutdown
        const shutdown = (signal) => {
            console.log(`\n${signal} received – shutting down interview service gracefully`);
            server.close(() => {
                console.log("Interview HTTP server closed");
                process.exit(0);
            });
            setTimeout(() => process.exit(1), 10_000);
        };
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));
    } catch (error) {
        console.error("Failed to start Interview service:", error);
        process.exit(1);
    }
};

startServer();
