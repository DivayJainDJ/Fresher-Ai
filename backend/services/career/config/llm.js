import { ChatGroq } from "@langchain/groq"
import dotenv from "dotenv"
dotenv.config()

const llm = new ChatGroq({
    model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
    temperature: 0.2,
    maxTokens: 3000,
    maxRetries: 3,
    reasoning_effort: "none",
})

export default llm
