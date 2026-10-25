import { dependencyHealth } from "../../shared/utils/health.js"
import { requestLogger } from "../../shared/middleware/requestLogger.js"
import express from "express";
import dotenv from "dotenv";
dotenv.config();
import cookieParser from "cookie-parser";
import morgan from "morgan";
import cors from "cors";
import { connectDb } from "./configs/db.js";
import dns from 'dns'
import authRouter from "./routes/auth.route.js";



const app = express()
app.use(requestLogger("auth"));

app.use(express.json());

app.use(cookieParser());

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

app.get("/health", (_req, res) => dependencyHealth("auth", res));

app.use("/", authRouter);

const PORT = process.env.PORT || 8001;

const startServer = async () => {
    try {
        await connectDb();

        const server = app.listen(PORT, "0.0.0.0", () => {
            console.log(`Auth Service Started on ${PORT}`);
        });

        // Graceful shutdown
        const shutdown = (signal) => {
            console.log(`\n${signal} received – shutting down auth service gracefully`);
            server.close(() => {
                console.log("Auth HTTP server closed");
                process.exit(0);
            });
            setTimeout(() => process.exit(1), 10_000);
        };
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));
    } catch (error) {
        console.error("Failed to start Auth Service:", error);
        process.exit(1);
    }
};

startServer();
