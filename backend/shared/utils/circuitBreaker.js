const breakers = {};

const getBreaker = (name) => {
  if (!breakers[name]) breakers[name] = { failures: 0, lastFailure: 0, isOpen: false, threshold: 4, cooldownMs: 90_000 };
  return breakers[name];
};

export const isBreakerOpen = (name) => {
  const breaker = getBreaker(name);
  if (!breaker.isOpen) return false;
  if (Date.now() - breaker.lastFailure >= breaker.cooldownMs) {
    breaker.isOpen = false;
    breaker.failures = 0;
    console.log(`[CircuitBreaker:${name}] HALF-OPEN – allowing probe request`);
    return false;
  }
  return true;
};

export const recordBreakerFailure = (name) => {
  const breaker = getBreaker(name);
  const wasOpen = breaker.isOpen;
  breaker.failures += 1;
  breaker.lastFailure = Date.now();
  if (breaker.failures >= breaker.threshold) breaker.isOpen = true;
  return !wasOpen && breaker.isOpen;
};

export const resetBreaker = (name) => {
  const breaker = getBreaker(name);
  breaker.failures = 0;
  breaker.isOpen = false;
};

export const resetCircuit = () => Object.keys(breakers).forEach(resetBreaker);
