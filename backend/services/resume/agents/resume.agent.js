import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import llm from "../config/llm.js"
import { cleanJson, invokeWithRetry } from "../../../shared/utils/cleanJson.js"
import { z } from "zod"
import { wrapUntrustedText } from "../../../shared/prompts/untrustedText.js"
import { readFile } from "node:fs/promises"

const resumeSchema = z.object({
    name: z.string().default(""), email: z.string().default(""), phone: z.string().default(""), summary: z.string().default(""),
    skills: z.array(z.string()).default([]), projects: z.array(z.string()).default([]), education: z.array(z.string()).default([]), experience: z.array(z.string()).default([]),
    strengths: z.array(z.string()).default([]), weaknesses: z.array(z.string()).default([]), missingSkills: z.array(z.string()).default([]), suggestedRole: z.string().default(""),
    score: z.number().finite().default(0), recommendations: z.array(z.string()).default([]),
}).passthrough()

export const resumeAgent = async (resumeText, { skipCache = false, promptVersion = "v1", targetRole = "" } = {}) => {
    if (!/^v[12]$/.test(promptVersion)) throw new RangeError(`Unsupported resume prompt version: ${promptVersion}`)
    const prompt = await readFile(new URL(`../prompts/resume.${promptVersion}.txt`, import.meta.url), "utf8")
    const response = await invokeWithRetry(llm, [
        new SystemMessage(prompt),
        new HumanMessage([
            targetRole ? wrapUntrustedText("target_role", targetRole) : "No target role was supplied.",
            wrapUntrustedText("resume_text", resumeText),
        ].join("\n")),
    ], 3, { skipCache, feature: "resume-scoring" })

    const cleaned = cleanJson(response.content)
    const parsed = resumeSchema.parse(JSON.parse(cleaned))
    parsed.score = Math.max(0, Math.min(100, parsed.score))
    return JSON.stringify(parsed)
}
