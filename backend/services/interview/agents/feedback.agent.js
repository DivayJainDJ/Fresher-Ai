import llm from "../config/llm.js";
import feedbackPrompt from "../prompts/feedbackPrompt.js";
import { cleanJson, invokeWithRetry } from "../../../shared/utils/cleanJson.js";
import behavioralFeedbackPrompt from "../prompts/behavioralFeedbackPrompt.js";
import { z } from "zod";

const behavioralFeedbackSchema = z.object({
    starScore: z.object({
        situation: z.number().int().min(0).max(5), task: z.number().int().min(0).max(5),
        action: z.number().int().min(0).max(5), result: z.number().int().min(0).max(5),
    }).strict(),
    clarity: z.number().int().min(0).max(100),
    confidence: z.number().int().min(0).max(100),
    improvedAnswer: z.string().min(1).max(6000),
    nextSteps: z.array(z.string().min(1).max(300)).min(2).max(4),
}).strict();

export const feedbackAgent = async (data) => {
    if (data.type?.toLowerCase() === "behavioral") {
        const response = await invokeWithRetry(llm, behavioralFeedbackPrompt(data), 3, { skipCache: true });
        const feedback = behavioralFeedbackSchema.parse(JSON.parse(cleanJson(response.content)));
        if (data.answer.trim().split(/\s+/).length <= 5 && feedback.starScore.result > 1) {
            feedback.starScore.result = 1;
            if (!feedback.nextSteps.some((step) => /result|outcome|impact/i.test(step))) {
                feedback.nextSteps[feedback.nextSteps.length - 1] = "Add the result, outcome, or measurable impact.";
            }
        }
        if (data.deliveryMetrics) {
            const metrics = data.deliveryMetrics;
            feedback.nextSteps = [...feedback.nextSteps, `Delivery: ${metrics.wordsPerMinute} words per minute, ${metrics.fillerCount} filler words, and a ${Math.round(metrics.longestPauseMs / 1000)} second longest pause.`];
            if (metrics.fillerCount >= 3) feedback.nextSteps.push("Replace filler words with brief pauses.");
            else if (metrics.wordsPerMinute > 170) feedback.nextSteps.push("Slow down slightly between key points.");
            feedback.nextSteps = feedback.nextSteps.slice(0, 4);
        }
        if (data.question?.toLowerCase().includes("restructure this rough story")) {
            feedback.improvedAnswer = feedback.improvedAnswer
                .replace(/\bSituation:\s*/i, "Situation: ")
                .replace(/\bTask:\s*/i, "\nTask: ")
                .replace(/\bAction:\s*/i, "\nAction: ")
                .replace(/\bResult:\s*/i, "\nResult: ");
        }
        return feedback;
    }
    const response = await invokeWithRetry(llm, feedbackPrompt(data), 3, { skipCache: true })
    const feedback = JSON.parse(cleanJson(response.content))
    const metrics = data.deliveryMetrics
    if (metrics) {
        const delivery = `Delivery: ${metrics.wordsPerMinute} words per minute, ${metrics.fillerCount} filler words, longest pause ${Math.round(metrics.longestPauseMs / 1000)} seconds.`
        feedback.feedback = `${feedback.feedback || ""} ${delivery}`.trim()
        if (metrics.fillerCount >= 3) feedback.improvements = [...(feedback.improvements || []), "Replace filler words with brief pauses."].slice(0, 3)
        else if (metrics.wordsPerMinute > 170) feedback.improvements = [...(feedback.improvements || []), "Slow down slightly between key points."].slice(0, 3)
    }
    return feedback
}
