import { dependencyHealth } from "../../shared/utils/health.js"
import { requestLogger } from "../../shared/middleware/requestLogger.js"
import express from "express"
import dotenv from "dotenv"
import cookieParser from "cookie-parser"
import { connectDB } from "./configs/db.js"
import roadmapRouter from "./routes/roadmap.route.js"
dotenv.config()

const app = express()
app.use(requestLogger("roadmap"))
app.use(express.json())
app.use(cookieParser())

const PORT = process.env.PORT || 6004

app.get("/health", (_req, res) => dependencyHealth("roadmap", res));

app.use("/", roadmapRouter);

const startServer = async () => {
    try {
        await connectDB();

        const server = app.listen(PORT, "0.0.0.0", () => {
            console.log(`Roadmap-service Started on ${PORT}`);
        });

        // Graceful shutdown
        const shutdown = (signal) => {
            console.log(`\n${signal} received – shutting down roadmap service gracefully`);
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