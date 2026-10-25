const METRICS_KEY = "{llm}:metrics";
const PREFIX = "{llm}:metric:";
let redisClient;
const getRedis = async () => {
  if (!redisClient) redisClient = (await import("../redis/redis.js")).default;
  return redisClient;
};

export const incrementLlmMetric = async (name, amount = 1) => {
  try {
    const redis = await getRedis();
    if (redis.status !== "ready") return;
    await redis.eval("redis.call('INCRBY', KEYS[1], ARGV[1]); redis.call('SADD', KEYS[2], ARGV[2]); return 1", 2, `${PREFIX}${name}`, METRICS_KEY, amount, name);
  } catch (error) {
    console.warn("[LLM metrics] write failed:", error.message);
  }
};

export const recordProviderLatency = async (provider, durationMs) => {
  const key = `${PREFIX}provider:${provider}:latency`;
  try {
    const redis = await getRedis();
    if (redis.status !== "ready") return;
    await redis.eval("local value = tonumber(ARGV[1]); redis.call('HINCRBY', KEYS[1], 'count', 1); redis.call('HINCRBY', KEYS[1], 'totalMs', value); local current = tonumber(redis.call('HGET', KEYS[1], 'maxMs') or '0'); if value > current then redis.call('HSET', KEYS[1], 'maxMs', value) end; redis.call('SADD', KEYS[2], ARGV[2]); return 1", 2, key, METRICS_KEY, Math.max(0, Math.round(durationMs)), `provider:${provider}:latency`);
  } catch (error) {
    console.warn("[LLM metrics] latency write failed:", error.message);
  }
};

export const recordFailoverLatency = async (durationMs) => {
  const key = `${PREFIX}failoverLatency`;
  try {
    const redis = await getRedis();
    if (redis.status !== "ready") return;
    await redis.eval("local value = tonumber(ARGV[1]); redis.call('HINCRBY', KEYS[1], 'count', 1); redis.call('HINCRBY', KEYS[1], 'totalMs', value); local current = tonumber(redis.call('HGET', KEYS[1], 'maxMs') or '0'); if value > current then redis.call('HSET', KEYS[1], 'maxMs', value) end; redis.call('SADD', KEYS[2], 'failoverLatency'); return 1", 2, key, METRICS_KEY, Math.max(0, Math.round(durationMs)));
  } catch (error) { console.warn("[LLM metrics] failover latency write failed:", error.message); }
};

export const readLlmMetrics = async () => {
  try {
    const redis = await getRedis();
    if (redis.status !== "ready") return null;
    const names = await redis.smembers(METRICS_KEY);
    const result = { cacheHits: 0, cacheMisses: 0, retries: 0, breakerOpens: 0, failovers: 0, providerSuccess: {}, providerLatencyMs: {}, failoverLatencyMs: {} };
    for (const name of names) {
      if (name.startsWith("provider:") && name.endsWith(":latency")) {
        const provider = name.slice("provider:".length, -":latency".length);
        result.providerLatencyMs[provider] = await redis.hgetall(`${PREFIX}${name}`);
      } else if (name === "failoverLatency") {
        result.failoverLatencyMs = await redis.hgetall(`${PREFIX}${name}`);
      } else {
        const value = Number(await redis.get(`${PREFIX}${name}`)) || 0;
        if (name.startsWith("providerSuccess:")) result.providerSuccess[name.slice("providerSuccess:".length)] = value;
        else if (Object.hasOwn(result, name)) result[name] = value;
      }
    }
    return result;
  } catch (error) {
    console.warn("[LLM metrics] read failed:", error.message);
    return null;
  }
};
