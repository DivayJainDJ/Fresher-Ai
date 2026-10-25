export const COIN_COSTS = Object.freeze({
  "resume-scorer": 10,
  "resume-builder": 10,
  "roadmap-builder": 20,
  "start-interview": 50,
  "interview-feedback": 5,
  "download-pdf": 10,
  "code-review": 5,
});

export const getCoinCost = (action) => COIN_COSTS[action] ?? null;

export const canSpendCoins = (balance, action) => {
  const cost = getCoinCost(action);
  return Number.isFinite(balance) && cost !== null && balance >= cost;
};
