// Weights describe the relative contribution of modules once they have data.
// Missing modules are removed and the remaining weights are normalized per user.
export const READINESS_WEIGHTS = Object.freeze({
  interview: 0.25, // Interview performance is the strongest job-readiness signal.
  resume: 0.15, // A scored resume matters, but should not dominate practical skills.
  quiz: 0.15, // Broad fundamentals from timed quizzes.
  sql: 0.15, // Demonstrated data querying skill.
  coding: 0.15, // Coding challenge correctness.
  roadmap: 0.15, // Completion of the user's personalized learning plan.
});
