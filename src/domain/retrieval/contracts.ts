import { z } from "zod";
import {
  RadarCategorySchema,
  KnowledgeCategorySchema,
} from "@/domain/console/taxonomy";
export const RETRIEVAL_INDEX_VERSION = "campus-fts-v1";
export const RetrievalQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(300),
    purpose: z.enum(["knowledge", "events"]).default("knowledge"),
    // "最近有什么竞赛/讲座" means the newest items in the radar category, not
    // the best lexical match (which may be a March event).
    sort: z.enum(["relevance", "published_desc"]).default("relevance"),
    category: z
      .union([RadarCategorySchema, KnowledgeCategorySchema])
      .optional(),
    sourceTypes: z
      .array(z.enum(["official_web", "wechat_subscription", "wechat_service"]))
      .min(1)
      .max(3)
      .optional(),
    sourceId: z.string().min(1).max(128).optional(),
    publishedAfter: z.iso.date().optional(),
    publishedBefore: z.iso.date().optional(),
    publishedCursor: z
      .object({
        at: z.string().min(10).max(40),
        id: z.string().min(1).max(128),
      })
      .strict()
      .optional(),
    // Exact-title lookup for "找到这篇文章"; still verified by the same
    // publication/permission checks as keyword retrieval.
    title: z.string().trim().min(4).max(300).optional(),
    limit: z.number().int().min(1).max(6).default(4),
    documentIds: z.array(z.string().max(128)).max(80).optional(),
  })
  .strict();
export type RetrievalQuery = z.input<typeof RetrievalQuerySchema>;
export const RetrievalMetricsSchema = z.object({
  rowsRead: z.number().nonnegative(),
  rowsWritten: z.number().nonnegative(),
  queries: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  candidateChunks: z.number().int().nonnegative(),
  candidateActivities: z.number().int().nonnegative().optional(),
  usageAvailable: z.boolean(),
  queryPlanVersion: z.literal("query-v2").optional(),
  recallLanes: z
    .array(
      z.object({ name: z.string(), limit: z.number(), candidates: z.number() }),
    )
    .max(3)
    .optional(),
});
export const EvidenceHitSchema = z
  .object({
    documentId: z.string(),
    chunkId: z.string(),
    title: z.string().max(250),
    sourceId: z.string(),
    sourceName: z.string().max(250),
    originalUrl: z.url(),
    publishedAt: z.string().nullable(),
    contentSnippet: z.string().max(800),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
    evidenceBasis: z.enum(["normalized_text", "title", "activity_projection"]),
    evidenceType: z.enum(["full_text", "excerpt", "metadata"]),
    bodyAvailable: z.boolean(),
    bodyPartial: z.boolean(),
    relevanceScore: z.number(),
    rankingReasons: z.array(z.string()).max(8),
    classificationState: z.enum(["radar", "knowledge", "unknown"]),
    radarCategory: RadarCategorySchema.nullable(),
    knowledgeCategory: KnowledgeCategorySchema.nullable(),
    classificationOrigin: z.string(),
    contentRevision: z.number().int(),
    inputHash: z.string(),
    documentVersion: z.number().int(),
    publicAvailable: z.literal(true),
    validity: z.enum(["current", "historical", "expired", "unknown"]),
    official: z.boolean(),
    readable: z.boolean(),
    linkedSources: z
      .array(
        z.object({
          documentId: z.string(),
          sourceName: z.string(),
          url: z.url(),
        }),
      )
      .max(4),
    calendarUrl: z
      .string()
      .regex(/^\/calendar\?date=\d{4}-\d{2}-\d{2}&event=event-[a-f0-9]{40}$/)
      .optional(),
  })
  .strict();
export type EvidenceHit = z.infer<typeof EvidenceHitSchema>;
export const RetrievalResultSchema = z.object({
  hits: z.array(EvidenceHitSchema).max(6),
  metrics: RetrievalMetricsSchema,
  indexVersion: z.enum([RETRIEVAL_INDEX_VERSION, "calendar-v1", "calendar-v2"]),
  method: z.enum(["fts5_keywords_and_domain_expansion", "calendar_index"]),
  warnings: z.array(z.string()).max(8),
});
export type RetrievalResult = z.infer<typeof RetrievalResultSchema>;
export const PUBLIC_RETRIEVAL_SCOPE = Object.freeze({
  kind: "public" as const,
});
export interface KnowledgeRetriever {
  retrieve(
    query: RetrievalQuery,
    scope: typeof PUBLIC_RETRIEVAL_SCOPE,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<RetrievalResult>;
}
