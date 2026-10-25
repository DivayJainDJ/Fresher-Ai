import BehavioralQuestion from "../models/behavioralQuestion.model.js";

export const behavioralQuestions = [
  ["introduction", "Tell me about yourself and the experiences that led you to this role."],
  ["introduction", "What strengths would your teammates say you bring to a team?"],
  ["introduction", "Why are you interested in this role and our organization?"],
  ["introduction", "What kind of work motivates you to do your best?"],
  ["teamwork", "Tell me about a time you helped a team meet a difficult goal."],
  ["teamwork", "Describe a time you collaborated with someone whose approach differed from yours."],
  ["teamwork", "How have you helped a teammate who was falling behind?"],
  ["teamwork", "Tell me about a time your team achieved more through collaboration."],
  ["conflict", "Describe a disagreement with a teammate and how you resolved it."],
  ["conflict", "Tell me about a time you received feedback you initially disagreed with."],
  ["conflict", "How did you handle a difficult conversation at work or school?"],
  ["conflict", "Describe a time you helped two people reach agreement."],
  ["failure", "Tell me about a mistake you made and what you learned from it."],
  ["failure", "Describe a goal you did not meet and how you responded."],
  ["failure", "What is a project that did not go as planned, and what would you change?"],
  ["failure", "Tell me about a time you had to recover from a setback."],
  ["leadership", "Describe a time you took initiative without being asked."],
  ["leadership", "Tell me about a time you helped guide a group through uncertainty."],
  ["leadership", "How have you motivated others toward a shared goal?"],
  ["leadership", "Describe a difficult decision you made with limited information."],
  ["salary", "What compensation range are you targeting for this role?"],
  ["salary", "How did you arrive at your salary expectations?"],
  ["salary", "What factors matter most to you when evaluating an offer?"],
  ["salary", "How would you respond if an offer were below your target range?"],
].map(([category, question]) => ({ category, question }));

export const seedBehavioralQuestions = async (BehavioralQuestionModel = BehavioralQuestion) => {
  const operations = behavioralQuestions.map(({ category, question }) => ({
    updateOne: { filter: { category, question }, update: { $setOnInsert: { category, question, active: true } }, upsert: true },
  }));
  return BehavioralQuestionModel.bulkWrite(operations, { ordered: false });
};
