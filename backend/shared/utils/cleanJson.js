import crypto from "crypto";
import redis from "../redis/redis.js";

export function cleanJson(raw) {
    return String(raw)
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<think>[\s\S]*/gi, "")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
   PER-PROVIDER CIRCUIT BREAKERS
   Each provider (groq / gemini / cerebras) gets its own breaker
   so one dead/rate-limited provider doesn't block the others.
   ============================================================ */
const breakers = {};

function getBreaker(name) {
    if (!breakers[name]) {
        breakers[name] = {
            failures: 0,
            lastFailure: 0,
            isOpen: false,
            threshold: 4,
            cooldownMs: 90_000,
        };
    }
    return breakers[name];
}

function isBreakerOpen(name) {
    const b = getBreaker(name);
    if (!b.isOpen) return false;

    const elapsed = Date.now() - b.lastFailure;
    if (elapsed >= b.cooldownMs) {
        b.isOpen = false;
        b.failures = 0;
        console.log(`[CircuitBreaker:${name}] HALF-OPEN – allowing probe request`);
        return false;
    }
    return true;
}

function recordBreakerFailure(name) {
    const b = getBreaker(name);
    b.failures++;
    b.lastFailure = Date.now();
    if (b.failures >= b.threshold) {
        b.isOpen = true;
        console.error(
            `[CircuitBreaker:${name}] OPEN – ${b.failures} consecutive failures. ` +
            `Cooling down for ${b.cooldownMs / 1000}s.`
        );
    }
}

function resetBreaker(name) {
    const b = getBreaker(name);
    b.failures = 0;
    b.isOpen = false;
}

// Kept for backwards compatibility with any existing imports.
export function resetCircuit() {
    Object.keys(breakers).forEach(resetBreaker);
}

/* ============================================================
   RESPONSE CACHE (Redis)
   Identical prompts (same resume text, same interview config,
   etc.) return the cached answer instead of burning another
   free-tier LLM call. Best-effort only — cache failures never
   block a live request.
   ============================================================ */
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

function hashMessages(messages) {
    const normalized = messages.map((m) => ({
        role: typeof m._getType === "function" ? m._getType() : m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));
    return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function getCached(key) {
    try {
        const val = await redis.get(`llmcache:${key}`);
        return val ? JSON.parse(val) : null;
    } catch (error) {
        console.warn("[LLM cache] read failed:", error.message);
        return null;
    }
}

async function setCached(key, content) {
    try {
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
    return messages.map((m) => {
        const type = typeof m._getType === "function" ? m._getType() : m.role;
        const role =
            type === "human" ? "user" :
            type === "ai" ? "assistant" :
            type === "system" ? "system" :
            (type || "user");
        return { role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) };
    });
}

async function openAICompatCall({ baseURL, apiKey, model, messages, maxTokens, temperature }) {
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
        signal: AbortSignal.timeout(60_000),
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
    return content;
}

function buildProviderChain(primaryLlm, defaults) {
    const chain = [
        {
            name: "groq",
            call: async (messages) => {
                const response = await primaryLlm.invoke(messages);
                return response.content;
            },
        },
    ];

    // Optional fallback #1: Gemini free tier (set GEMINI_API_KEY to enable)
    if (process.env.GEMINI_API_KEY) {
        chain.push({
            name: "gemini",
            call: (messages) =>
                openAICompatCall({
                    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
                    apiKey: process.env.GEMINI_API_KEY,
                    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
                    messages: toPlainMessages(messages),
                    maxTokens: defaults.maxTokens,
                    temperature: defaults.temperature,
                }),
        });
    }

    // Optional fallback #2: Cerebras free tier (set CEREBRAS_API_KEY to enable)
    if (process.env.CEREBRAS_API_KEY) {
        chain.push({
            name: "cerebras",
            call: (messages) =>
                openAICompatCall({
                    baseURL: "https://api.cerebras.ai/v1",
                    apiKey: process.env.CEREBRAS_API_KEY,
                    model: process.env.CEREBRAS_MODEL || "llama-3.3-70b",
                    messages: toPlainMessages(messages),
                    maxTokens: defaults.maxTokens,
                    temperature: defaults.temperature,
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
export async function invokeWithRetry(llm, messages, maxAttempts = 3) {
    const cacheKey = hashMessages(messages);
    const cached = await getCached(cacheKey);
    if (cached) {
        return { content: cached };
    }

    const chain = buildProviderChain(llm, {
        maxTokens: llm?.maxTokens,
        temperature: llm?.temperature,
    });

    let lastError;

    for (const provider of chain) {
        if (isBreakerOpen(provider.name)) {
            console.warn(`[LLM] Skipping ${provider.name} – circuit open (cooling down)`);
            continue;
        }

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const content = await provider.call(messages);
                resetBreaker(provider.name);
                await setCached(cacheKey, content);
                return { content };
            } catch (error) {
                lastError = error;
                const retryable = isRetryableError(error);

                if (retryable && attempt < maxAttempts) {
                    const waitMs = retryDelayMs(error, attempt);
                    console.warn(
                        `[LLM:${provider.name}] attempt ${attempt}/${maxAttempts} failed ` +
                        `(${error.message}). Retrying in ${waitMs}ms`
                    );
                    await sleep(waitMs);
                    continue;
                }

                recordBreakerFailure(provider.name);
                console.warn(
                    `[LLM:${provider.name}] giving up after ${attempt} attempt(s): ${error.message}`
                );
                break; // fall through to next provider in the chain
            }
        }
    }

    throw lastError || new Error("All LLM providers failed");
}
