export const rateLimitDecision = (count, maxRequests, ttlMs) => ({
  allowed: count <= maxRequests,
  retryAfter: count <= maxRequests ? 0 : Math.max(1, Math.ceil(ttlMs / 1000)),
});
