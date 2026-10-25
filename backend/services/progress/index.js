import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db.js";
import { dependencyHealth } from "../../shared/utils/health.js";
import { requestLogger } from "../../shared/middleware/requestLogger.js";
import { installPrometheusMetrics } from "../../shared/observability/prometheus.js";
import progressRouter from "./routes/progress.route.js";
import { drainProgressBacklog, startProgressWorker, stopProgressWorker } from "./services/worker.js";

const app = express();
app.use((req, res, next) => {
  req.requestId = req.headers["x-request-id"];
  next();
});
app.use(requestLogger("progress"));
installPrometheusMetrics(app, "progress");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.get("/health", (_req, res) => dependencyHealth("progress", res));
app.post("/internal/events/drain", async (_req, res) => {
  try {
    const processed = await drainProgressBacklog();
    return res.json({ success: true, processed });
  } catch (error) {
    console.error(JSON.stringify({ service: "progress", event: "scheduled_drain_failed", error: error.message }));
    return res.status(503).json({ success: false, message: "Could not drain event backlog" });
  }
});
app.use("/", progressRouter);

const start = async () => {
  await connectDB();
  await startProgressWorker();
  const port = process.env.PORT || 6006;
  const server = app.listen(port, "0.0.0.0", () => console.log(`Progress service started on ${port}`));
  const shutdown = async (signal) => {
    console.log(`${signal} received; shutting down progress service`);
    await stopProgressWorker();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

start().catch((error) => {
  console.error("Failed to start progress service", error);
  process.exit(1);
});
