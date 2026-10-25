import redis from "../../shared/redis/redis.js";
import { rateLimitDecision } from "../../shared/utils/rateLimitDecision.js";
import { fixedWindowScript, tokenBucketScript } from "../../shared/utils/tokenBucket.js";

export const rateLimiter = (maxRequests = 30, windowMs = 60_000) => {
    return async (req, res, next) => {
        const key = req.user?.userId || req.headers["x-user-id"] || req.ip || "anonymous";
        const bucket = Math.floor(Date.now() / windowMs);
        const redisKey = `rate-limit:${key}:${bucket}`;
        try {
            const [count, ttl] = await redis.eval(fixedWindowScript, 1, redisKey, windowMs);
            const decision = rateLimitDecision(count, maxRequests, ttl);
            if (!decision.allowed) {
                const retryAfter = decision.retryAfter;
                res.setHeader("Retry-After", retryAfter);
                return res.status(429).json({
                    success: false,
                    code: "RATE_LIMITED",
                    retryAfter,
                    message: `You're sending requests a bit too fast. Please retry in ${retryAfter}s.`,
                });
            }
            return next();
        } catch (error) {
            console.error("rate limiter Redis error:", error.message);
            return res.status(503).json({ success: false, message: "Rate limiting is temporarily unavailable" });
        }
    };
};

export const tokenBucketRateLimiter = ({ capacity = 12, refillPerSecond = 0.2, cost = 1, keyPrefix = "rate-limit:token", redisClient = redis } = {}) => {
    return async (req, res, next) => {
        const userKey = req.user?.userId || req.headers["x-user-id"] || req.ip || "anonymous";
        try {
            const result = await redisClient.eval(
                tokenBucketScript,
                1,
                `${keyPrefix}:${userKey}`,
                capacity,
                refillPerSecond / 1000,
                cost
            );
            const isAllowed = Number(result[0]) === 1;
            const retryValue = result[1];
            if (!isAllowed) {
                const seconds = Math.max(1, Number(retryValue) || 1);
                res.setHeader("Retry-After", seconds);
                return res.status(429).json({ success: false, code: "RATE_LIMITED", retryAfter: seconds, message: `You're sending requests a bit too fast. Please retry in ${seconds}s.` });
            }
            return next();
        } catch (error) {
            console.error("token bucket Redis error:", error.message);
            return res.status(503).json({ success: false, message: "Rate limiting is temporarily unavailable" });
        }
    };
};
