import { dependencyHealth } from "../../shared/utils/health.js"
import { requestLogger } from "../../shared/middleware/requestLogger.js"
import express from "express"
import dotenv from "dotenv"
import cookieParser from "cookie-parser"
import { connectDB } from "./configs/db.js"
import billingRouter from "./routes/billing.route.js"

dotenv.config()

const app = express()
app.use(requestLogger("billing"))
app.use(express.json({ verify: (req, _res, buffer) => { if (req.originalUrl.startsWith("/webhook")) req.rawBody = Buffer.from(buffer) } }))
app.use(cookieParser())

const PORT = process.env.PORT || 6005

app.get("/health", (_req, res) => dependencyHealth("billing", res));


app.get("/", (_req, res) => {
    res.send("Hello from Billing-service");
});

app.use("/", billingRouter);

const startServer = async () => {
    try {
        await connectDB();

        const server = app.listen(PORT, "0.0.0.0", () => {
            console.log(`Billing-service Started on ${PORT}`);
        });

        // Graceful shutdown
        const shutdown = (signal) => {
            console.log(`\n${signal} received – shutting down billing service gracefully`);
            server.close(() => {
                console.log("Billing HTTP server closed");
                process.exit(0);
            });
            setTimeout(() => process.exit(1), 10_000);
        };
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGINT", () => shutdown("SIGINT"));
    } catch (error) {
        console.error("Failed to start Billing service:", error);
        process.exit(1);
    }
};

startServer();
