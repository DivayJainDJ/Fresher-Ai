/** Small deterministic synthetic cases used by the fast unit test suite. */
export function buildResumeEvalCases(count = 30) {
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new RangeError("Resume evaluation case count must be between 1 and 50");
  }

  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: `synthetic-${String(number).padStart(2, "0")}`,
      text: `Candidate ${number}: original synthetic evaluation text. Built fictional projects, measured outcomes, and role-relevant experience for a software engineering position.`,
      referenceScore: 50 + ((number * 13) % 46),
    };
  });
}

export function summarizeScores(scores, referenceScore) {
  if (!Array.isArray(scores) || scores.length === 0 || scores.some((score) => !Number.isFinite(score))) {
    throw new TypeError("At least one finite score is required");
  }
  if (!Number.isFinite(referenceScore)) throw new TypeError("A finite reference score is required");

  const mean = scores.reduce((total, score) => total + score, 0) / scores.length;
  // Evaluation runs are treated as the complete set of runs being summarized.
  const variance = scores.reduce((total, score) => total + (score - mean) ** 2, 0) / scores.length;
  const round = (value) => Number(value.toFixed(2));
  const roundedMean = round(mean);
  const absoluteError = round(Math.abs(mean - referenceScore));

  return {
    runs: scores.length,
    mean: roundedMean,
    standardDeviation: round(Math.sqrt(variance)),
    referenceScore,
    absoluteError,
    agreementWithinFive: absoluteError <= 5,
  };
}
