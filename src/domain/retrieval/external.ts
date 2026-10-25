import { z } from "zod";
export const ExternalSearchInputSchema = z
  .object({
    query: z.string().trim().min(2).max(300),
    gap: z.enum([
      "no_internal_answer",
      "missing_detail",
      "student_experience",
      "freshness_check",
    ]),
    limit: z.number().int().min(1).max(4).default(3),
  })
  .strict();
export const ExternalItemSchema = z
  .object({
    title: z.string().min(1).max(250),
    originalUrl: z.url().refine((v) => /^https:\/\//.test(v)),
    sourceName: z.string().max(160),
    platform: z.enum(["web", "xiaohongshu"]),
    authority: z.enum(["official", "student_experience", "unverified"]),
    evidenceKind: z.enum(["page_excerpt", "search_excerpt", "title_only"]),
    snippet: z.string().max(700),
    publishedAt: z.string().nullable(),
    retrievedAt: z.string(),
    searchMode: z.enum(["web", "platform", "public_web"]),
    canConfirmAdministrativeFacts: z.boolean(),
  })
  .strict();
export type ExternalItem = z.infer<typeof ExternalItemSchema>;
export const ExternalSearchResultSchema = z
  .object({
    status: z.enum(["ok", "partial", "unavailable"]),
    intent: z.enum(["official", "experience", "mixed", "events", "general"]),
    query: z.string(),
    items: z.array(ExternalItemSchema).max(6),
    providers: z
      .array(
        z.object({
          provider: z.string(),
          status: z.enum([
            "ok",
            "empty",
            "unavailable",
            "login_required",
            "rate_limited",
            "not_configured",
            "busy",
          ]),
          durationMs: z.number(),
          count: z.number().int().nonnegative(),
          httpStatus: z.number().int().min(100).max(599).optional(),
          edgeCode: z.number().int().optional(),
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
        }),
      )
      .max(3),
    warnings: z.array(z.string().max(250)).max(8),
    durationMs: z.number().nonnegative(),
  })
  .strict();
export type ExternalSearchResult = z.infer<typeof ExternalSearchResultSchema>;
