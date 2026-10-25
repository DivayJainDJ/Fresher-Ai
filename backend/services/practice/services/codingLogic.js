import { z } from "zod";

export const codingProblemIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export const codingLanguageSchema = z.enum(["javascript", "python"]);
export const codeAttemptSchema = z.object({
  language: codingLanguageSchema,
  passedCount: z.number().int().min(0).max(200),
  totalCount: z.number().int().min(1).max(200),
  runtimeMs: z.number().int().min(0).max(30_000),
}).strict().refine((value) => value.passedCount <= value.totalCount, "passedCount cannot exceed totalCount");
