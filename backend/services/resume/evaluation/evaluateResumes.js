import fs from "node:fs/promises";
import { resumeAgent } from "../agents/resume.agent.js";
import { buildResumeEvalCases, summarizeScores } from "./resumeCases.js";

const arg = (name, fallback) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=")[1];
  return value === undefined ? fallback : Number(value);
};

const count = arg("count", 30);
const runsPerCase = arg("runs", 3);
if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY && !process.env.CEREBRAS_API_KEY) {
  console.error("Set at least one LLM provider key before running the resume evaluation harness.");
  process.exitCode = 1;
} else if (!Number.isInteger(runsPerCase) || runsPerCase < 2 || runsPerCase > 10) {
  console.error("--runs must be an integer from 2 to 10.");
  process.exitCode = 1;
} else {
  const cases = buildResumeEvalCases(count);
  const results = [];
  for (const sample of cases) {
    const scores = [];
    for (let run = 0; run < runsPerCase; run += 1) {
      const output = JSON.parse(await resumeAgent(sample.text, { skipCache: true }));
      scores.push(output.score);
    }
    results.push({ id: sample.id, targetRole: sample.targetRole, ...summarizeScores(scores, sample.referenceScore) });
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    sampleCount: cases.length,
    runsPerCase,
    totalModelCalls: cases.length * runsPerCase,
    agreementRate: Number((results.filter((result) => result.agreementWithinFive).length / results.length).toFixed(3)),
    meanStandardDeviation: Number((results.reduce((sum, result) => sum + result.standardDeviation, 0) / results.length).toFixed(2)),
    results,
  };
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  if (process.env.EVAL_OUTPUT) await fs.writeFile(process.env.EVAL_OUTPUT, serialized, "utf8");
  process.stdout.write(serialized);
}
