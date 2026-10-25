import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export const requestLogger = (service) => (req, res, next) => {
  const started = Date.now();
  const requestId = req.headers["x-request-id"] || "unknown";
  res.on("finish", () => {
    logger.info({ service, requestId, method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: Date.now() - started }, "request completed");
  });
  next();
};
