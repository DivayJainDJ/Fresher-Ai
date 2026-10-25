import llm from "../config/llm.js";
import feedbackPrompt from "../prompts/feedbackPrompt.js";
import behavioralFeedbackPrompt from "../prompts/behavioralFeedbackPrompt.js";
import { cleanJson, invokeWithRetry, streamWithRetry } from "../../../shared/utils/cleanJson.js";
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

const parseFeedback = (data, content) => {
    if (data.type?.toLowerCase() === "behavioral") {
        const feedback = behavioralFeedbackSchema.parse(JSON.parse(cleanJson(content)));
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
    const feedback = JSON.parse(cleanJson(content));
    const metrics = data.deliveryMetrics;
    if (metrics) {
        const delivery = `Delivery: ${metrics.wordsPerMinute} words per minute, ${metrics.fillerCount} filler words, longest pause ${Math.round(metrics.longestPauseMs / 1000)} seconds.`;
        feedback.feedback = `${feedback.feedback || ""} ${delivery}`.trim();
        if (metrics.fillerCount >= 3) feedback.improvements = [...(feedback.improvements || []), "Replace filler words with brief pauses."].slice(0, 3);
        else if (metrics.wordsPerMinute > 170) feedback.improvements = [...(feedback.improvements || []), "Slow down slightly between key points."].slice(0, 3);
    }
    return feedback;
};

export const feedbackMessages = (data) => data.type?.toLowerCase() === "behavioral"
    ? behavioralFeedbackPrompt(data)
    : feedbackPrompt(data);

export const feedbackAgent = async (data) => {
    const response = await invokeWithRetry(llm, feedbackMessages(data), 3, { skipCache: true });
    return parseFeedback(data, response.content);
};

const extractPartialString = (raw, field) => {
    const key = raw.indexOf(`"${field}"`);
    if (key < 0) return null;
    const colon = raw.indexOf(":", key);
    if (colon < 0) return null;
    const start = raw.indexOf('"', colon + 1);
    if (start < 0) return null;
    let escaped = false;
    for (let index = start + 1; index < raw.length; index += 1) {
        if (escaped) { escaped = false; continue; }
        if (raw[index] === "\\") { escaped = true; continue; }
        if (raw[index] === '"') {
            try { return JSON.parse(raw.slice(start, index + 1)); } catch { return raw.slice(start + 1, index); }
        }
    }
    const partial = raw.slice(start + 1);
    try { return JSON.parse(`"${partial}"`); } catch {
        return partial.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
};

export const streamFeedbackAgent = async (data, onToken, { signal } = {}) => {
    const field = data.type?.toLowerCase() === "behavioral" ? "improvedAnswer" : "feedback";
    let raw = "";
    let streamedText = "";
    const response = await streamWithRetry(llm, feedbackMessages(data), async (token) => {
        raw += token;
        const partial = extractPartialString(raw, field);
        if (partial == null || !partial.startsWith(streamedText)) return false;
        const next = partial.slice(streamedText.length);
        if (!next) return false;
        streamedText = partial;
        await onToken(next);
        return true;
    }, {
        signal,
        validateContent: (content) => parseFeedback(data, content),
    });
    const feedback = parseFeedback(data, response.content);
    const finalText = data.type?.toLowerCase() === "behavioral" ? feedback.improvedAnswer : feedback.feedback;
    if (!streamedText && finalText) await onToken(finalText);
    return { feedback, content: response.content, cached: response.cached };
};
