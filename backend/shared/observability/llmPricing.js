// USD per million tokens. Update this table when model pricing changes.
// Sources: Groq https://console.groq.com/docs/model/qwen/qwen3.8-27b
// Google https://ai.google.dev/gemini-api/docs/pricing
// Cerebras https://inference-docs.cerebras.ai/support/pricing
export const MODEL_TOKEN_PRICES_USD_PER_MILLION = {
  "qwen/qwen3.8-27b": { input: 0.8, output: 4.0 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
  "llama-3.3-70b": { input: 0.85, output: 1.2 },
};
