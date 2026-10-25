export const tokenBucketScript = `
local capacity = tonumber(ARGV[1])
local refillPerMs = tonumber(ARGV[2])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local cost = tonumber(ARGV[3])
local state = redis.call('HMGET', KEYS[1], 'tokens', 'updatedAt')
local tokens = tonumber(state[1]) or capacity
local updatedAt = tonumber(state[2]) or now
tokens = math.min(capacity, tokens + math.max(0, now - updatedAt) * refillPerMs)
local allowed = 0
local retryAfter = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryAfter = math.ceil((cost - tokens) / refillPerMs / 1000)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updatedAt', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / refillPerMs))
return {allowed, retryAfter}
`;

export const fixedWindowScript = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export const tokenBucketDecision = ({ tokens, updatedAt, now, capacity, refillPerSecond, cost = 1 }) => {
  const elapsedSeconds = Math.max(0, (now - updatedAt) / 1000);
  const available = Math.min(capacity, tokens + elapsedSeconds * refillPerSecond);
  if (available >= cost) {
    return { allowed: true, tokens: available - cost, updatedAt: now, retryAfter: 0 };
  }
  return {
    allowed: false,
    tokens: available,
    updatedAt: now,
    retryAfter: Math.max(1, Math.ceil((cost - available) / refillPerSecond)),
  };
};
