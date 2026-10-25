import { z } from "zod";

export const sqlAttemptSchema = z.object({
  passed: z.boolean(),
  attemptMs: z.number().int().min(0).max(3_600_000),
}).strict();
export const sqlProblemIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
