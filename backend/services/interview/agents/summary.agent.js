import llm from "../config/llm.js";
import summaryPrompt from "../prompts/summaryPrompt.js";
import { cleanJson, invokeWithRetry } from "../../../shared/utils/cleanJson.js";

export const summaryAgent = async (data, { signal } = {}) => {
    const response = await invokeWithRetry(llm, summaryPrompt(data), 3, { signal })
    return JSON.parse(cleanJson(response.content))
}
