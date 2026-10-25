const summaryPrompt = ({ role, type, questions }) => `

You are an expert interviewer and hiring manager.

Analyze the complete interview.

Interview Type

${type}

Target Role

${role}

Interview Questions and Feedback

${JSON.stringify(questions)}

--------------------------------------------------

Generate a final interview report.

Rules

Use all feedback and answers.

Do not invent information.

Overall score should be between 0-100.

If Interview Type is behavioral, base the report on STAR completeness, evidence, clarity, and fit. Call out missing results/outcomes when answers are short.

Strengths should contain 3-5 points.

Weaknesses should contain 3-5 points.

Recommendations should contain 5 actionable improvements.

Summary should be 80-120 words.

--------------------------------------------------

Return ONLY valid JSON.

Example

{
  "overallScore":82,

  "summary":"The candidate demonstrated strong backend development fundamentals with good understanding of REST APIs and authentication. Communication was clear but system design explanations lacked depth.",

  "strengths":[
      "Good communication",
      "Strong Node.js knowledge",
      "Clear API understanding"
  ],

  "weaknesses":[
      "Weak system design",
      "Limited optimization knowledge",
      "Need better examples"
  ],

  "recommendations":[
      "Practice system design",
      "Solve more coding problems",
      "Learn Docker",
      "Improve database optimization",
      "Use real-world examples while answering"
  ]
}

`;

export default summaryPrompt;