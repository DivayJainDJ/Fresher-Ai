import llm from "../config/llm.js";
import feedbackPrompt from "../prompts/feedbackPrompt.js";
import { cleanJson, invokeWithRetry } from "../../../shared/utils/cleanJson.js";

export const feedbackAgent = async (data) => {
    const response = await invokeWithRetry(llm, feedbackPrompt(data), 3, { skipCache: true })
    return JSON.parse(cleanJson(response.content))
}
