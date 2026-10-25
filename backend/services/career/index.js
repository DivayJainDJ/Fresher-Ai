import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db.js";
import { dependencyHealth } from "../../shared/utils/health.js";
import { requestLogger } from "../../shared/middleware/requestLogger.js";
import { installPrometheusMetrics } from "../../shared/observability/prometheus.js";
import careerRouter from "./routes/career.route.js";
import { initializeApplicationReminders, sendDueApplicationReminders, startApplicationReminderWorker, stopApplicationReminderWorker } from "./services/applicationReminders.js";

const app = express();
app.use((req, res, next) => { req.requestId = req.headers["x-request-id"]; next(); });
app.use(requestLogger("career"));
installPrometheusMetrics(app, "career");
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());
app.get("/health", (_req, res) => dependencyHealth("career", res));
app.post("/internal/reminders/run", async (_req, res) => {
  try { return res.json({ success: true, sent: await sendDueApplicationReminders() }); }
  catch (error) {
    console.error(JSON.stringify({ service: "career", event: "scheduled_reminders_failed", error: error.message }));
    return res.status(503).json({ success: false, message: "Could not send due reminders" });
  }
});
app.use("/", careerRouter);

const start = async () => {
  await connectDB();
  if (process.env.K_SERVICE) await initializeApplicationReminders();
  else await startApplicationReminderWorker();
  const port = process.env.PORT || 6008;
  const server = app.listen(port, "0.0.0.0", () => console.log(`Career service started on ${port}`));
  const shutdown = async (signal) => { console.log(`${signal} received; shutting down career service`); await stopApplicationReminderWorker(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};
start().catch((error) => { console.error("Failed to start career service", error); process.exit(1); });
