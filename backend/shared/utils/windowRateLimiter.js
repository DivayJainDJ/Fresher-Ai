export const allowRequest = ({ requests, now, limit, windowMs }) => {
  const active = requests.filter((timestamp) => now - timestamp < windowMs);
  if (active.length >= limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((active[0] + windowMs - now) / 1000)), requests: active };
  }
  active.push(now);
  return { allowed: true, retryAfter: 0, requests: active };
};
