import { z } from "zod";

export const sqlAttemptSchema = z.object({
  query: z.string().trim().min(1).max(12000),
  attemptMs: z.number().int().min(0).max(3_600_000),
}).strict();
export const sqlProblemIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
