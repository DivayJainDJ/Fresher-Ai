import crypto from "crypto";
import { isBreakerOpen, recordBreakerFailure, resetBreaker, resetCircuit } from "./circuitBreaker.js";
import { incrementLlmMetric, readLlmMetrics, recordFailoverLatency, recordProviderLatency } from "./llmMetrics.js";
import { recordCacheOperation, recordCircuitBreakerOpen, recordLlmCall, recordLlmRetry } from "../observability/prometheus.js";
export { resetCircuit } from "./circuitBreaker.js";

export { cleanJson } from "./json.js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const metrics = { cacheHits: 0, cacheMisses: 0, retries: 0, breakerOpens: 0, providerSuccess: {}, failovers: 0, providerLatencyMs: {}, failoverLatencyMs: { count: 0, totalMs: 0, maxMs: 0 } };
export const getLlmMetrics = () => JSON.parse(JSON.stringify(metrics));
export const getSharedLlmMetrics = () => readLlmMetrics();

/* ============================================================
   RESPONSE CACHE (Redis)
   Identical prompts (same resume text, same interview config,
   etc.) return the cached answer instead of burning another
   free-tier LLM call. Best-effort only — cache failures never
   block a live request.
   ============================================================ */
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

function normalizeMessages(messages) {
    return Array.isArray(messages) ? messages : [{ role: "user", content: String(messages ?? "") }];
}

function hashMessages(messages) {
    const normalized = normalizeMessages(messages).map((m) => ({
        role: typeof m._getType === "function" ? m._getType() : m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));
    return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

let redisClient;
const getRedis = async () => {
    if (!redisClient) redisClient = (await import("../redis/redis.js")).default;
    return redisClient;
};

async function getCached(key) {
    try {
        const redis = await getRedis();
        const val = await redis.get(`llmcache:${key}`);
        return val ? JSON.parse(val) : null;
    } catch (error) {
        console.warn("[LLM cache] read failed:", error.message);
        return null;
    }
}

async function setCached(key, content) {
    try {
        const redis = await getRedis();
        await redis.set(`llmcache:${key}`, JSON.stringify(content), "EX", CACHE_TTL_SECONDS);
    } catch (error) {
        console.warn("[LLM cache] write failed:", error.message);
    }
}

/* ============================================================
   MULTI-PROVIDER FALLBACK
   Primary: Groq (the langchain `llm` instance already configured
   per-service). If it's rate-limited/down, we fall through to
   any other free-tier providers whose API keys are present in
   the environment — Gemini and Cerebras both expose an
   OpenAI-compatible /chat/completions endpoint, so one generic
   caller covers both.
   ============================================================ */
function toPlainMessages(messages) {
    return normalizeMessages(messages).map((m) => {
        const type = typeof m._getType === "function" ? m._getType() : m.role;
        const role =
            type === "human" ? "user" :
            type === "ai" ? "assistant" :
            type === "system" ? "system" :
            (type || "user");
        return { role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) };
    });
}

async function openAICompatCall({ baseURL, apiKey, model, messages, maxTokens, temperature, signal }) {
    const timeoutSignal = AbortSignal.timeout(60_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const res = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens || 3000,
            temperature: typeof temperature === "number" ? temperature : 0.2,
        }),
        signal: requestSignal,
    });

    if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const error = new Error(`${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`);
        error.status = res.status;
        throw error;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from provider");
    return { content, usage: data.usage };
}

async function* streamOpenAICompatCall({ baseURL, apiKey, model, messages, maxTokens, temperature, signal }) {
    const timeoutSignal = AbortSignal.timeout(60_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const res = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, Accept: "text/event-stream" },
        body: JSON.stringify({ model, messages: toPlainMessages(messages), max_tokens: maxTokens || 3000, temperature: typeof temperature === "number" ? temperature : 0.2, stream: true, stream_options: { include_usage: true } }),
        signal: requestSignal,
    });
    if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const error = new Error(`${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`);
        error.status = res.status;
        throw error;
    }
    if (!res.body) throw new Error("Provider did not return a streaming response");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const parseLine = (line) => {
        if (!line.startsWith("data:")) return null;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") return data === "[DONE]" ? { done: true } : null;
        try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content;
            if (typeof token === "string" && token) return { content: token };
            if (parsed.usage) return { usage: parsed.usage };
            return null;
        } catch { return null; }
    };
    while (true) {
        if (signal?.aborted) throw signal.reason || new Error("Streaming request aborted");
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
            const item = parseLine(line);
            if (item?.done) { await reader.cancel(); return; }
            if (item) yield item;
        }
        if (done) break;
    }
    if (buffer) {
        const item = parseLine(buffer);
        if (item) yield item;
    }
}

async function streamPrimary(provider, messages, signal, onToken) {
    let content = "";
    let usage;
    const chunks = await provider.stream(messages, { signal });
    const iterator = chunks[Symbol.asyncIterator]();
    let removeAbortListener;
    const aborted = signal ? new Promise((_, reject) => {
        const onAbort = () => reject(signal.reason || new Error("Streaming request aborted"));
        if (signal.aborted) onAbort();
        else {
            signal.addEventListener("abort", onAbort, { once: true });
            removeAbortListener = () => signal.removeEventListener("abort", onAbort);
        }
    }) : new Promise(() => {});
    try {
        while (true) {
            const { value: chunk, done } = await Promise.race([iterator.next(), aborted]);
            if (done) break;
            usage = chunk?.usage_metadata || chunk?.response_metadata?.tokenUsage || chunk?.usage || usage;
            const value = chunk?.content;
            const token = typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => part?.text || "").join("") : "";
            if (!token) continue;
            content += token;
            await onToken(token);
        }
        return { content, usage };
    } catch (error) {
        if (signal?.aborted) void iterator.return?.();
        throw error;
    } finally {
        removeAbortListener?.();
    }
}

function buildProviderChain(primaryLlm, defaults) {
    const chain = [
        {
            name: "groq",
            model: process.env.GROQ_MODEL || primaryLlm?.model || "qwen/qwen3.8-27b",
            call: async (messages, signal) => {
                const response = await primaryLlm.invoke(messages, { signal });
                return { content: response.content, usage: response.usage_metadata || response.response_metadata?.tokenUsage };
            },
        },
    ];

    // Optional fallback #1: Gemini free tier (set GEMINI_API_KEY to enable)
    if (process.env.GEMINI_API_KEY) {
        chain.push({
            name: "gemini",
            model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
            call: (messages, signal) =>
                openAICompatCall({
                    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
                    apiKey: process.env.GEMINI_API_KEY,
                    model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
                    messages: toPlainMessages(messages),
                    maxTokens: defaults.maxTokens,
                    temperature: defaults.temperature,
                    signal,
                }),
        });
    }

    // Optional fallback #2: Cerebras free tier (set CEREBRAS_API_KEY to enable)
    if (process.env.CEREBRAS_API_KEY) {
        chain.push({
            name: "cerebras",
            model: process.env.CEREBRAS_MODEL || "llama-3.3-70b",
            call: (messages, signal) =>
                openAICompatCall({
                    baseURL: "https://api.cerebras.ai/v1",
                    apiKey: process.env.CEREBRAS_API_KEY,
                    model: process.env.CEREBRAS_MODEL || "llama-3.3-70b",
                    messages: toPlainMessages(messages),
                    maxTokens: defaults.maxTokens,
                    temperature: defaults.temperature,
                    signal,
                }),
        });
    }

    return chain;
}

function isRetryableError(error) {
    const status = error?.status;
    const msg = (error?.message || "").toLowerCase();
    return (
        status === 429 ||
        status === 500 ||
        status === 503 ||
        msg.includes("429") ||
        msg.includes("rate_limit") ||
        msg.includes("rate limit") ||
        msg.includes("tokens per minute") ||
        msg.includes("requests per minute") ||
        msg.includes("overloaded")
    );
}

function retryDelayMs(error, attempt) {
    let retryAfterSec = null;
    const headerVal = error?.headers?.["retry-after"];
    if (headerVal) retryAfterSec = parseFloat(headerVal);

    const bodyMatch = error?.message?.match(/try again in (\d+\.?\d*)s/i);
    if (bodyMatch) retryAfterSec = parseFloat(bodyMatch[1]);

    const backoffMs = Math.min(1500 * 2 ** (attempt - 1), 15_000);
    if (retryAfterSec) {
        return Math.max(Math.ceil(retryAfterSec * 1000) + 500, backoffMs);
    }
    return backoffMs;
}

/**
 * Invoke an LLM with caching, retries, and automatic fallback across
 * every provider that has an API key configured. `llm` is the primary
 * (Groq) langchain instance already built per-service — unchanged
 * call sites keep working exactly as before.
 */
const defaultCache = { get: getCached, set: setCached };
const defaultMetrics = { increment: incrementLlmMetric, providerLatency: recordProviderLatency, failoverLatency: recordFailoverLatency };

export async function invokeWithRetry(llm, messages, maxAttempts = 3, { skipCache = false, providers, cache = defaultCache, metricsSink = defaultMetrics, signal, feature = "unspecified" } = {}) {
    if (signal?.aborted) throw signal.reason || new Error("LLM request aborted");
    const cacheKey = hashMessages(messages);
    const cached = skipCache ? null : await cache.get(cacheKey);
    if (signal?.aborted) throw signal.reason || new Error("LLM request aborted");
    if (cached) {
        metrics.cacheHits += 1;
        await metricsSink.increment("cacheHits");
        recordCacheOperation("hit", feature);
        return { content: cached };
    }
    if (!skipCache) { metrics.cacheMisses += 1; await metricsSink.increment("cacheMisses"); recordCacheOperation("miss", feature); }

    const chain = providers || buildProviderChain(llm, {
        maxTokens: llm?.maxTokens,
        temperature: llm?.temperature,
    });
    const inputChars = toPlainMessages(messages).reduce((total, message) => total + message.content.length, 0);

    let lastError;

    let previousProviderFailed = false;
    let firstFailureAt = 0;
    for (const provider of chain) {
        if (isBreakerOpen(provider.name)) {
            console.warn(`[LLM] Skipping ${provider.name} – circuit open (cooling down)`);
            if (!firstFailureAt) firstFailureAt = Date.now();
            previousProviderFailed = true;
            continue;
        }

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const startedAt = Date.now();
                if (signal?.aborted) throw signal.reason || new Error("LLM request aborted");
                const response = await provider.call(messages, signal);
                const content = typeof response === "string" ? response : response?.content;
                const usage = typeof response === "object" ? response.usage : null;
                recordLlmCall({ provider: provider.name, model: provider.model || provider.name, outcome: "success", feature, usage, inputChars, outputChars: typeof content === "string" ? content.length : 0 });
                const latency = metrics.providerLatencyMs[provider.name] || { count: 0, totalMs: 0, maxMs: 0 };
                latency.count += 1;
                latency.totalMs += Date.now() - startedAt;
                latency.maxMs = Math.max(latency.maxMs, Date.now() - startedAt);
                metrics.providerLatencyMs[provider.name] = latency;
                await metricsSink.providerLatency(provider.name, Date.now() - startedAt);
                resetBreaker(provider.name);
                metrics.providerSuccess[provider.name] = (metrics.providerSuccess[provider.name] || 0) + 1;
                await metricsSink.increment(`providerSuccess:${provider.name}`);
                if (previousProviderFailed) {
                    const failoverLatency = Date.now() - firstFailureAt;
                    metrics.failovers += 1;
                    metrics.failoverLatencyMs.count += 1;
                    metrics.failoverLatencyMs.totalMs += failoverLatency;
                    metrics.failoverLatencyMs.maxMs = Math.max(metrics.failoverLatencyMs.maxMs, failoverLatency);
                    await metricsSink.increment("failovers");
                    await metricsSink.failoverLatency(failoverLatency);
                }
                if (!skipCache) await cache.set(cacheKey, content);
                return { content };
            } catch (error) {
                if (signal?.aborted) throw error;
                lastError = error;
                if (!firstFailureAt) firstFailureAt = Date.now();
                previousProviderFailed = true;
                const retryable = isRetryableError(error);

                if (retryable && attempt < maxAttempts) {
                    metrics.retries += 1;
                    await metricsSink.increment("retries");
                    recordLlmRetry(feature);
                    const waitMs = retryDelayMs(error, attempt);
                    console.warn(
                        `[LLM:${provider.name}] attempt ${attempt}/${maxAttempts} failed ` +
                        `(${error.message}). Retrying in ${waitMs}ms`
                    );
                    if (signal) {
                        await new Promise((resolve, reject) => {
                            let timeout;
                            const cleanup = () => signal.removeEventListener("abort", abort);
                            const abort = () => { clearTimeout(timeout); cleanup(); reject(signal.reason || new Error("LLM request aborted")); };
                            timeout = setTimeout(() => { cleanup(); resolve(); }, waitMs);
                            signal.addEventListener("abort", abort, { once: true });
                        });
                    } else await sleep(waitMs);
                    continue;
                }

                if (recordBreakerFailure(provider.name)) { metrics.breakerOpens += 1; await metricsSink.increment("breakerOpens"); recordCircuitBreakerOpen(provider.name); }
                recordLlmCall({ provider: provider.name, model: provider.model || provider.name, outcome: "error", feature, inputChars });
                console.warn(
                    `[LLM:${provider.name}] giving up after ${attempt} attempt(s): ${error.message}`
                );
                break; // fall through to next provider in the chain
            }
        }
    }

    throw lastError || new Error("All LLM providers failed");
}


/** Stream a response with the same shared cache, provider chain, metrics, and circuit breakers. */
export async function streamWithRetry(llm, messages, onToken, { signal, providers, cache = defaultCache, metricsSink = defaultMetrics, maxAttempts = 3, validateContent, feature = "unspecified" } = {}) {
    if (signal?.aborted) throw signal.reason || new Error("Streaming request aborted");
    const cacheKey = hashMessages(messages);
    const cached = await cache.get(cacheKey);
    if (signal?.aborted) throw signal.reason || new Error("Streaming request aborted");
    if (cached) {
        metrics.cacheHits += 1;
        await metricsSink.increment("cacheHits");
        recordCacheOperation("hit", feature);
        await onToken(cached);
        return { content: cached, cached: true };
    }
    metrics.cacheMisses += 1;
    await metricsSink.increment("cacheMisses");
    recordCacheOperation("miss", feature);

    const defaults = { maxTokens: llm?.maxTokens, temperature: llm?.temperature };
    const inputChars = toPlainMessages(messages).reduce((total, message) => total + message.content.length, 0);
    const chain = providers || [
        { name: "groq", model: process.env.GROQ_MODEL || llm?.model || "qwen/qwen3.8-27b", stream: (input, config) => llm.stream(input, config) },
        ...(process.env.GEMINI_API_KEY ? [{ name: "gemini", model: process.env.GEMINI_MODEL || "gemini-3.7-flash", stream: (input, config) => streamOpenAICompatCall({ baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || "gemini-3.7-flash", messages: input, maxTokens: defaults.maxTokens, temperature: defaults.temperature, signal: config.signal }) }] : []),
        ...(process.env.CEREBRAS_API_KEY ? [{ name: "cerebras", model: process.env.CEREBRAS_MODEL || "llama-3.3-70b", stream: (input, config) => streamOpenAICompatCall({ baseURL: "https://api.cerebras.ai/v1", apiKey: process.env.CEREBRAS_API_KEY, model: process.env.CEREBRAS_MODEL || "llama-3.3-70b", messages: input, maxTokens: defaults.maxTokens, temperature: defaults.temperature, signal: config.signal }) }] : []),
    ];

    let hasEmittedToken = false;
    let previousProviderFailed = false;
    let firstFailureAt = 0;
    let lastError;
    for (const provider of chain) {
        if (isBreakerOpen(provider.name)) {
            previousProviderFailed = true;
            if (!firstFailureAt) firstFailureAt = Date.now();
            continue;
        }
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            let providerEmitted = false;
            let providerOutputChars = 0;
            const startedAt = Date.now();
            try {
                const response = await streamPrimary(provider, messages, signal, async (token) => {
                    providerOutputChars += token.length;
                    const visible = await onToken(token);
                    if (visible !== false) {
                        providerEmitted = true;
                        hasEmittedToken = true;
                    }
                });
                const content = response.content;
                if (!content) throw new Error("Empty response from provider");
                await validateContent?.(content);
                recordLlmCall({ provider: provider.name, model: provider.model || provider.name, outcome: "success", feature, usage: response.usage, inputChars, outputChars: content.length });
                resetBreaker(provider.name);
                metrics.providerSuccess[provider.name] = (metrics.providerSuccess[provider.name] || 0) + 1;
                await metricsSink.increment(`providerSuccess:${provider.name}`);
                const latencyMs = Date.now() - startedAt;
                const latency = metrics.providerLatencyMs[provider.name] || { count: 0, totalMs: 0, maxMs: 0 };
                latency.count += 1;
                latency.totalMs += latencyMs;
                latency.maxMs = Math.max(latency.maxMs, latencyMs);
                metrics.providerLatencyMs[provider.name] = latency;
                await metricsSink.providerLatency(provider.name, latencyMs);
                if (previousProviderFailed) {
                    const duration = Date.now() - firstFailureAt;
                    metrics.failovers += 1;
                    metrics.failoverLatencyMs.count += 1;
                    metrics.failoverLatencyMs.totalMs += duration;
                    metrics.failoverLatencyMs.maxMs = Math.max(metrics.failoverLatencyMs.maxMs, duration);
                    await metricsSink.increment("failovers");
                    await metricsSink.failoverLatency(duration);
                }
                await cache.set(cacheKey, content);
                return { content, cached: false };
            } catch (error) {
                lastError = error;
                if (signal?.aborted) throw error;
                if (providerEmitted || hasEmittedToken) {
                    if (recordBreakerFailure(provider.name)) {
                        metrics.breakerOpens += 1;
                        await metricsSink.increment("breakerOpens");
                        recordCircuitBreakerOpen(provider.name);
                    }
                    recordLlmCall({ provider: provider.name, model: provider.model || provider.name, outcome: "error", feature, inputChars, outputChars: providerOutputChars });
                    throw error;
                }
                if (isRetryableError(error) && attempt < maxAttempts) {
                    metrics.retries += 1;
                    await metricsSink.increment("retries");
                    recordLlmRetry(feature);
                    const delay = retryDelayMs(error, attempt);
                    await new Promise((resolve, reject) => {
                        let timeout;
                        const cleanup = () => signal?.removeEventListener("abort", abort);
                        const abort = () => { clearTimeout(timeout); cleanup(); reject(signal.reason || new Error("Streaming request aborted")); };
                        timeout = setTimeout(() => { cleanup(); resolve(); }, delay);
                        signal?.addEventListener("abort", abort, { once: true });
                    });
                    continue;
                }
                if (recordBreakerFailure(provider.name)) {
                    metrics.breakerOpens += 1;
                    await metricsSink.increment("breakerOpens");
                    recordCircuitBreakerOpen(provider.name);
                }
                recordLlmCall({ provider: provider.name, model: provider.model || provider.name, outcome: "error", feature, inputChars, outputChars: providerOutputChars });
                previousProviderFailed = true;
                if (!firstFailureAt) firstFailureAt = Date.now();
                break;
            }
        }
    }
    throw lastError || new Error("All LLM providers failed");
}
