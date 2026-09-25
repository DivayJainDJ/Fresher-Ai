const clients = new Map();

export const rateLimiter = (maxRequests = 30, windowMs = 60_000) => {
    return (req, res, next) => {
        const key = req.user?.userId || req.headers["x-user-id"] || req.ip || "anonymous";
        const now = Date.now();

        if (!clients.has(key)) {
            clients.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        const client = clients.get(key);

        if (now > client.resetAt) {
            client.count = 1;
            client.resetAt = now + windowMs;
            return next();
        }

        client.count++;

        if (client.count > maxRequests) {
            const retryAfter = Math.ceil((client.resetAt - now) / 1000);
            res.setHeader("Retry-After", retryAfter);
            return res.status(429).json({
                success: false,
                code: "RATE_LIMITED",
                retryAfter,
                message: `You're sending requests a bit too fast. Please retry in ${retryAfter}s.`,
            });
        }

        next();
    };
};

setInterval(() => {
    const now = Date.now();
    for (const [key, client] of clients) {
        if (now > client.resetAt) {
            clients.delete(key);
        }
    }
}, 60_000);
