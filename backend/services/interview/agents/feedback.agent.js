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
    return JSON.parse(cleanJson(response.content))
}
