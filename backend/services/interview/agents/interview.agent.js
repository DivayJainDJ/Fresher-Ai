import llm from "../config/llm.js"
import hrInterviewPrompt from "../prompts/hrInterviewPrompt.js"
import technicalInterviewPrompt from "../prompts/technicalInterviewPrompt.js"
import { cleanJson, invokeWithRetry } from "../../../shared/utils/cleanJson.js"

export const interviewAgent = async (data) => {
    const prompt = data.type?.toLowerCase() === "hr"
        ? hrInterviewPrompt(data)
        : technicalInterviewPrompt(data)

    const response = await invokeWithRetry(llm, prompt, 3, { skipCache: true })
    const parsed = JSON.parse(cleanJson(response.content))
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Empty questions array")
    }
    return parsed
}
