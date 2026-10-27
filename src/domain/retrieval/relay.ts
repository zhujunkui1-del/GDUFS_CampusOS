import { z } from "zod";
import { ExternalItemSchema } from "./external";
export const RelayInputSchema = z
  .object({
    kind: z.enum(["web", "xiaohongshu"]),
    query: z.string().min(2).max(300),
    limit: z.number().int().min(1).max(4),
    policy: z
      .object({
        intent: z.enum([
          "official",
          "experience",
          "mixed",
          "events",
          "general",
        ]),
        officialOnly: z.boolean(),
        campus: z.boolean(),
        recent: z.boolean().optional(),
      })
      .strict(),
    onlyXhs: z.boolean().default(false),
  })
  .strict();
export type RelayInput = z.infer<typeof RelayInputSchema>;
export const RelayResultSchema = z
  .object({
    provider: z.string().min(1).max(64),
    status: z.enum([
      "ok",
      "empty",
      "unavailable",
      "login_required",
      "rate_limited",
      "not_configured",
      "busy",
    ]),
    items: z.array(ExternalItemSchema).max(4),
    durationMs: z.number().nonnegative(),
    cacheHit: z.boolean().optional(),
    failureCode: z
      .enum([
        "HTTP_ERROR",
        "INVALID_RESPONSE",
        "RESPONSE_LIMIT",
        "FETCH_CONTEXT",
        "NETWORK_ERROR",
        "RATE_LIMITED",
      ])
      .optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    edgeCode: z.number().int().optional(),
  })
  .strict();
export const RelayWorkSchema = z
  .object({ id: z.string().uuid(), input: RelayInputSchema })
  .strict();
export const RelayFinishSchema = z
  .object({
    id: z.string().uuid(),
    runnerId: z.string().uuid(),
    result: RelayResultSchema,
  })
  .strict();
export const RelayUsageSchema = z.object({
  queries: z.number().int().nonnegative(),
  rowsRead: z.number().nonnegative(),
  rowsWritten: z.number().nonnegative(),
  usageAvailable: z.boolean(),
});
export type RelayUsage = z.infer<typeof RelayUsageSchema>;
