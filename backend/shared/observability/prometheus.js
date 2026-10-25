import client from "prom-client";
import { MODEL_TOKEN_PRICES_USD_PER_MILLION } from "./llmPricing.js";

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: "fresherai_" });

const httpRequests = new client.Counter({
  name: "fresherai_http_requests_total",
  help: "Completed HTTP requests by service, route and status.",
  labelNames: ["service", "method", "route", "status_code"],
  registers: [registry],
});
const httpDuration = new client.Histogram({
  name: "fresherai_http_request_duration_seconds",
  help: "HTTP response duration in seconds.",
  labelNames: ["service", "method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});
const httpErrors = new client.Counter({
  name: "fresherai_http_errors_total",
  help: "HTTP responses with status 400 or above.",
  labelNames: ["service", "method", "route", "status_code"],
  registers: [registry],
});
const llmCalls = new client.Counter({
  name: "fresherai_llm_calls_total",
  help: "LLM provider attempts by provider, feature and outcome.",
  labelNames: ["provider", "outcome", "feature"],
  registers: [registry],
});
const llmTokens = new client.Counter({
  name: "fresherai_llm_tokens_total",
  help: "LLM input and output tokens, with estimated values identified.",
  labelNames: ["provider", "model", "feature", "direction", "estimated"],
  registers: [registry],
});
const llmCost = new client.Gauge({
  name: "fresherai_llm_estimated_cost_usd_total",
  help: "Process-lifetime estimated LLM token cost in USD, using shared model pricing configuration.",
  labelNames: ["model", "feature", "pricing_configured"],
  registers: [registry],
});
const cacheOperations = new client.Counter({
  name: "fresherai_llm_cache_operations_total",
  help: "Shared LLM cache hits and misses.",
  labelNames: ["result", "feature"],
  registers: [registry],
});
const llmRetries = new client.Counter({
  name: "fresherai_llm_retries_total",
  help: "Retries made while calling LLM providers.",
  labelNames: ["feature"],
  registers: [registry],
});
const breakerOpens = new client.Counter({
  name: "fresherai_circuit_breaker_opens_total",
  help: "Circuit breakers newly opened after provider failures.",
  labelNames: ["provider"],
  registers: [registry],
});
const jobQueueDepth = new client.Gauge({
  name: "fresherai_job_queue_depth",
  help: "Queued plus active background jobs by service and queue.",
  labelNames: ["service", "queue"],
  registers: [registry],
});
const jobOutcomes = new client.Counter({
  name: "fresherai_job_outcomes_total",
  help: "Background job outcomes by queue and result.",
  labelNames: ["queue", "outcome"],
  registers: [registry],
});
const coinSpend = new client.Counter({
  name: "fresherai_coins_spent_total",
  help: "Coins spent by feature.",
  labelNames: ["feature"],
  registers: [registry],
});
const coinRefund = new client.Counter({
  name: "fresherai_coins_refunded_total",
  help: "Coins refunded by feature.",
  labelNames: ["feature"],
  registers: [registry],
});
const eventBusLag = new client.Histogram({
  name: "fresherai_event_bus_lag_seconds",
  help: "Time from event creation to consumer processing.",
  labelNames: ["consumer_group", "event_type"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300, 900],
  registers: [registry],
});

const normalizeRoute = (req) => {
  const routePath = req.route?.path;
  if (routePath) return `${req.baseUrl || ""}${routePath}`.replace(/\/$/, "") || "/";
  return (req.path || "/")
    .split("/")
    .map((part) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part) || /^[0-9a-f]{24}$/i.test(part) ? ":id" : part)
    .join("/")
    .slice(0, 120);
};

export const prometheusMiddleware = (service) => (req, res, next) => {
  if (req.path === "/metrics") return next();
  const started = process.hrtime.bigint();
  res.once("finish", () => {
    const labels = { service, method: req.method, route: normalizeRoute(req), status_code: String(res.statusCode) };
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    httpRequests.inc(labels);
    httpDuration.observe(labels, seconds);
    if (res.statusCode >= 400) httpErrors.inc(labels);
  });
  next();
};

export const installPrometheusMetrics = (app, service) => {
  app.use(prometheusMiddleware(service));
  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  });
};

const usageValue = (usage, ...keys) => {
  for (const key of keys) {
    const value = Number(usage?.[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
};

export const recordLlmCall = ({ provider, model, outcome, feature = "unspecified", usage, inputChars = 0, outputChars = 0 }) => {
  llmCalls.inc({ provider, outcome, feature });
  const prices = MODEL_TOKEN_PRICES_USD_PER_MILLION[model];
  const inputActual = usageValue(usage, "input_tokens", "prompt_tokens", "promptTokens");
  const outputActual = usageValue(usage, "output_tokens", "completion_tokens", "completionTokens");
  const inputTokens = inputActual ?? Math.ceil(Math.max(0, inputChars) / 4);
  const outputTokens = outputActual ?? Math.ceil(Math.max(0, outputChars) / 4);
  const inputEstimated = inputActual === null;
  const outputEstimated = outputActual === null;
  if (inputTokens) llmTokens.inc({ provider, model, feature, direction: "input", estimated: String(inputEstimated) }, inputTokens);
  if (outputTokens) llmTokens.inc({ provider, model, feature, direction: "output", estimated: String(outputEstimated) }, outputTokens);
  if (prices) {
    const costUsd = (inputTokens * prices.input + outputTokens * prices.output) / 1_000_000;
    llmCost.inc({ model, feature, pricing_configured: "true" }, costUsd);
  } else {
    llmCost.inc({ model, feature, pricing_configured: "false" }, 0);
  }
};

export const recordCacheOperation = (result, feature = "unspecified") => cacheOperations.inc({ result, feature });
export const recordLlmRetry = (feature = "unspecified") => llmRetries.inc({ feature });
export const recordCircuitBreakerOpen = (provider) => breakerOpens.inc({ provider });
export const recordQueueDepth = (service, queue, depth) => jobQueueDepth.set({ service, queue }, Math.max(0, depth));
export const recordJobOutcome = (queue, outcome) => jobOutcomes.inc({ queue, outcome });
export const recordCoinSpend = (feature, amount) => coinSpend.inc({ feature }, amount);
export const recordCoinRefund = (feature, amount) => coinRefund.inc({ feature }, amount);
export const recordEventBusLag = (consumerGroup, eventType, seconds) => {
  if (Number.isFinite(seconds) && seconds >= 0) eventBusLag.observe({ consumer_group: consumerGroup, event_type: eventType }, seconds);
};
