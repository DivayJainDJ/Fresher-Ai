const archetypes = [
  { role: "Frontend Engineer", referenceScore: 82, resume: "Built accessible React interfaces for a campus scheduling product. Improved first-load time by 32% by splitting routes and reducing image payloads. Skills: JavaScript, React, TypeScript, CSS, accessibility, Vitest." },
  { role: "Backend Engineer", referenceScore: 78, resume: "Created Node.js REST endpoints for a library lending app and added PostgreSQL indexes that reduced report queries from 900ms to 280ms. Skills: Node.js, Express, PostgreSQL, Redis, Jest." },
  { role: "Data Analyst", referenceScore: 76, resume: "Cleaned 18 months of retail inventory data with SQL and Python, then built a Power BI dashboard used in weekly planning. Documented assumptions and checked totals with finance. Skills: SQL, Python, pandas, Power BI." },
  { role: "Cloud Support Associate", referenceScore: 68, resume: "Completed a cloud operations internship. Wrote scripts to check Linux disk usage and documented incident handoffs. Practiced IAM, networking, and container basics in a personal lab. Skills: Linux, Bash, Docker, AWS fundamentals." },
  { role: "Mobile Developer", referenceScore: 74, resume: "Built a Kotlin Android habit tracker with offline storage and input validation. Added screen-reader labels and fixed a crash found through manual testing. Skills: Kotlin, Android, Room, Git." },
  { role: "QA Engineer", referenceScore: 72, resume: "Designed regression checks for an online booking prototype and reported reproducible defects with expected and actual results. Automated the highest-use flows. Skills: Playwright, JavaScript, API testing, GitHub Actions." },
  { role: "Machine Learning Intern", referenceScore: 70, resume: "Compared baseline classifiers for a student project using a held-out data split. Recorded precision and recall and documented data leakage risks. Skills: Python, scikit-learn, pandas, Jupyter." },
  { role: "Product Designer", referenceScore: 67, resume: "Researched onboarding problems with five student volunteers, sketched alternatives, and prototyped a simpler flow in Figma. Checked keyboard navigation with a developer. Skills: Figma, prototyping, user interviews, accessibility." },
  { role: "Security Analyst", referenceScore: 65, resume: "Reviewed sample access logs in a lab, grouped suspicious login patterns, and wrote a short escalation guide. Practiced least-privilege permissions and safe evidence handling. Skills: networking, Linux, log analysis, IAM." },
  { role: "Full-Stack Engineer", referenceScore: 80, resume: "Shipped a volunteer sign-up app with a React client and Express API. Added server-side validation, basic authorization, and MongoDB indexes. Skills: React, Node.js, Express, MongoDB, REST, Git." },
];

export const buildResumeEvalCases = (count = 30) => {
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new RangeError("Evaluation case count must be between 1 and 50");
  return Array.from({ length: count }, (_, index) => {
    const base = archetypes[index % archetypes.length];
    const variant = Math.floor(index / archetypes.length) + 1;
    return {
      id: `synthetic-${String(index + 1).padStart(2, "0")}`,
      targetRole: base.role,
      referenceScore: base.referenceScore,
      text: `Candidate ${index + 1} | Variant ${variant}\nTarget role: ${base.role}\n${base.resume}\n\nThis is original synthetic evaluation text. Variant ${variant} uses the same rubric profile with a different candidate identifier.`,
    };
  });
};

export const summarizeScores = (runs, referenceScore) => {
  if (!runs.length || runs.some((score) => !Number.isFinite(score))) throw new TypeError("Evaluation scores must be finite and non-empty");
  const mean = runs.reduce((sum, score) => sum + score, 0) / runs.length;
  const variance = runs.reduce((sum, score) => sum + (score - mean) ** 2, 0) / runs.length;
  return {
    runs: runs.length,
    mean: Number(mean.toFixed(2)),
    standardDeviation: Number(Math.sqrt(variance).toFixed(2)),
    referenceScore,
    absoluteError: Number(Math.abs(mean - referenceScore).toFixed(2)),
    agreementWithinFive: Math.abs(mean - referenceScore) <= 5,
  };
};
