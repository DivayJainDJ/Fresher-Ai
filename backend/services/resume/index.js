import { dependencyHealth } from "../../shared/utils/health.js"
import { requestLogger } from "../../shared/middleware/requestLogger.js"
import express from "express"
import dotenv from "dotenv"
import cors from "cors"
import { connectDB } from "./config/db.js"
import resumeRouter from "./routes/resume.route.js"
import { startResumeQueue } from "./services/resumeJobs.js"

dotenv.config()

const app = express()
app.use(requestLogger("resume"))

app.use(express.json())

const allowedOrigins = (process.env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const isAllowedOrigin = (origin) => !origin || allowedOrigins.includes(origin);

app.use(cors({
    origin(origin, callback) {
        if (isAllowedOrigin(origin)) {
            return callback(null, true);
        }

        return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
}));


const PORT = process.env.PORT || 6002

app.get("/health", (_req, res) => dependencyHealth("resume", res));

app.get("/", (_req, res) => {
    res.send("Hello from Resume-service");
});

app.use("/", resumeRouter);

const startServer = async () => {
    try {
        await connectDB()
        await startResumeQueue()

        const server = app.listen(PORT, "0.0.0.0", () => {
            console.log(`Resume-service Started on ${PORT}`);
        });

        // Graceful shutdown
        const shutdown = (signal) => {
            console.log(`\n${signal} received – shutting down resume service gracefully`);
            server.close(() => {
                console.log("Resume HTTP server closed");
                process.exit(0);
            });
            setTimeout(() => process.exit(1), 10_000);
        };
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));
    } catch (error) {
        console.error("Failed to start Resume service:", error)
        process.exit(1)
    }
}

startServer()
