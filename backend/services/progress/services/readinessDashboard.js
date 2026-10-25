import { READINESS_WEIGHTS } from "../config/readinessWeights.js";

const clamp = (value) => Math.max(0, Math.min(100, value));
const round = (value) => Math.round(value * 10) / 10;

export const buildReadinessBreakdown = (signals, weights = READINESS_WEIGHTS) => {
  const available = Object.entries(weights)
    .filter(([module]) => Number.isFinite(signals[module]) && signals[module] !== null)
    .map(([module, weight]) => ({ module, weight, score: clamp(signals[module]) }));
  const totalWeight = available.reduce((sum, item) => sum + item.weight, 0);
  const modules = available.map(({ module, weight, score }) => ({
    module,
    score: round(score),
    weight: totalWeight ? weight / totalWeight : 0,
  }));
  const readinessScore = totalWeight
    ? Math.round(available.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight)
    : null;
  return { readinessScore, modules, hasData: modules.length > 0 };
};

const task = (id, title, description, href, source) => ({ id, title, description, href, source });

export const buildDailyPlan = ({ roadmaps = [], weakTopics = [] }) => {
  const plan = [];
  const seen = new Set();
  const add = (item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key) || plan.length >= 3) return;
    seen.add(key);
    plan.push(item);
  };

  for (const roadmap of roadmaps) {
    const nextModule = (roadmap.modules || []).find((item) => !item.practiced);
    if (nextModule) add(task(
      `roadmap-${roadmap.id}-${plan.length}`,
      nextModule.title,
      `Continue ${roadmap.title}: ${nextModule.duration || "one learning session"}`,
      `/roadmap?id=${encodeURIComponent(roadmap.id)}`,
      "roadmap",
    ));
  }
  for (const topic of weakTopics) {
    const normalized = topic.toLowerCase();
    const href = /sql|database|query|join/.test(normalized) ? "/practice/sql"
      : /code|algorithm|array|tree|graph|dynamic program/.test(normalized) ? "/practice/coding"
        : "/practice";
    add(task(`weak-${plan.length}`, `Review ${topic}`, "Practice a topic that needs another pass.", href, "weak-topic"));
  }
  if (!plan.length) add(task("practice-quiz", "Take a fundamentals quiz", "Build a baseline across core interview topics.", "/practice", "suggested"));
  if (plan.length < 3) add(task("sql-practice", "Solve a SQL challenge", "Practice querying, grouping, and joins.", "/practice/sql", "suggested"));
  if (plan.length < 3) add(task("coding-practice", "Solve a coding challenge", "Work through a problem in the coding arena.", "/practice/coding", "suggested"));
  return plan.slice(0, 3);
};
