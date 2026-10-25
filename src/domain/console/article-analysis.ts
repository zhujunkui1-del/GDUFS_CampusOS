import { z } from "zod";
import {
  ContentTypeSchema,
  KnowledgeCategorySchema,
  RadarCategorySchema,
  TopicTagsSchema,
  RegistrationRequirementSchema,
  DerivedEventStatusSchema,
} from "./taxonomy";

export const ARTICLE_CLASSIFIER_VERSION = "article-content-v1";
export const ArticleAnalysisInputSchema = z
  .object({
    documentId: z.string().optional(),
    title: z.string().max(500),
    body: z.string().max(1_500_000).default(""),
    bodyFormat: z.enum(["plain", "reading_html"]).default("plain"),
    bodyStatus: z
      .enum(["unknown", "not_provided", "partial", "complete"])
      .default("complete"),
    sourceId: z.string().default(""),
    sourceName: z.string().default(""),
    originalUrl: z.string().default(""),
    publishedAt: z.string().nullable().default(null),
    contentType: ContentTypeSchema.default("unknown"),
  })
  .strict();
export type ArticleAnalysisInput = z.input<typeof ArticleAnalysisInputSchema>;
export const ArticleEvidenceSchema = z
  .object({
    field: z.enum(["title", "body"]),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
    text: z.string().max(2000),
    role: z.string().max(80),
  })
  .strict()
  .refine(
    (v) =>
      v.endOffset > v.startOffset &&
      v.endOffset - v.startOffset === v.text.length,
  );
export type ArticleEvidence = z.infer<typeof ArticleEvidenceSchema>;
export const ArticleTimePointSchema = z
  .object({
    raw: z.string(),
    date: z.iso.date().nullable(),
    at: z.iso.datetime({ offset: true }).nullable(),
    timezone: z.literal("Asia/Shanghai"),
    precision: z.enum(["unknown", "date", "exact_time"]),
    resolution: z.enum(["unknown", "day", "minute", "second"]),
    inferred: z.boolean(),
    inferenceBasis: z.string().nullable(),
    evidence: ArticleEvidenceSchema,
  })
  .strict();
export type ArticleTimePoint = z.infer<typeof ArticleTimePointSchema>;
export const RegistrationWindowSchema = z
  .object({
    roundLabel: z.string().nullable(),
    start: ArticleTimePointSchema.nullable(),
    end: ArticleTimePointSchema.nullable(),
    deadlineSemantics: z.enum(["before", "inclusive", "on", "unspecified"]),
    capacityLimited: z.boolean(),
    confidence: z.enum(["high", "medium", "low"]),
    evidence: z.array(ArticleEvidenceSchema).max(8),
    issues: z.array(z.string()),
  })
  .strict();
export type RegistrationWindow = z.infer<typeof RegistrationWindowSchema>;
export const ArticleActivitySchema = z
  .object({
    key: z.string(),
    title: z.string(),
    kind: z.enum(["event", "opportunity", "notice"]),
    category: RadarCategorySchema.nullable(),
    startsAt: ArticleTimePointSchema.nullable(),
    endsAt: ArticleTimePointSchema.nullable(),
    placeRaw: z.string().nullable(),
    organizer: z.string().nullable(),
    registrationStatus: RegistrationRequirementSchema,
    registrationWindows: z.array(RegistrationWindowSchema).max(12),
    registrationUrl: z.string().nullable(),
    otherDeadlines: z
      .array(
        z.object({
          role: z.enum([
            "work_submission",
            "material_submission",
            "payment",
            "results",
            "publicity",
          ]),
          time: ArticleTimePointSchema,
          evidence: ArticleEvidenceSchema,
        }),
      )
      .max(15),
    status: DerivedEventStatusSchema,
    evidence: z.array(ArticleEvidenceSchema).max(20),
    issues: z.array(z.string()),
  })
  .strict();
export const ArticleAnalysisSchema = z
  .object({
    primaryDestination: z.enum(["radar", "knowledge", "unknown"]),
    radarCategory: RadarCategorySchema.nullable(),
    knowledgeCategory: KnowledgeCategorySchema.nullable(),
    temporalType: z.enum(["short", "long", "mixed", "unknown"]),
    contentType: ContentTypeSchema,
    tags: TopicTagsSchema,
    auxiliaryDestinations: z.array(z.enum(["radar", "knowledge"])).max(2),
    classificationConfidence: z.enum(["high", "medium", "low"]),
    classificationReasons: z.array(z.string()).max(16),
    classificationEvidence: z.array(ArticleEvidenceSchema).max(20),
    classifierVersion: z.string(),
    method: z.literal("rules"),
    needsAssistance: z.boolean(),
    bodyAvailable: z.boolean(),
    registrationStatus: RegistrationRequirementSchema,
    hasRegistration: z.boolean(),
    activities: z.array(ArticleActivitySchema).max(12),
    knowledge: z.object({
      topic: z.string().nullable(),
      audience: z.array(z.string()).max(8),
      departments: z.array(z.string()).max(8),
      campusScope: z.enum([
        "all",
        "university_town",
        "baiyun",
        "online",
        "unknown",
      ]),
      conditions: z.array(ArticleEvidenceSchema).max(12),
      steps: z.array(ArticleEvidenceSchema).max(20),
      materials: z.array(ArticleEvidenceSchema).max(12),
      effectiveFrom: ArticleTimePointSchema.nullable(),
      effectiveUntil: ArticleTimePointSchema.nullable(),
      validity: z.enum(["current", "historical", "expired", "unknown"]),
    }),
    issues: z.array(z.string()).max(30),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.primaryDestination === "radar" &&
      (!v.radarCategory || v.knowledgeCategory)
    )
      ctx.addIssue({
        code: "custom",
        message: "Radar needs exactly its existing business category",
      });
    if (
      v.primaryDestination === "knowledge" &&
      (!v.knowledgeCategory || v.radarCategory)
    )
      ctx.addIssue({
        code: "custom",
        message: "Knowledge needs exactly its existing business category",
      });
    if (
      v.primaryDestination === "unknown" &&
      (v.radarCategory || v.knowledgeCategory)
    )
      ctx.addIssue({
        code: "custom",
        message: "Unknown may not silently assign a category",
      });
    if (v.hasRegistration !== (v.registrationStatus === "required"))
      ctx.addIssue({
        code: "custom",
        message: "Registration marker requires affirmative evidence",
      });
  });
export type ArticleAnalysis = z.infer<typeof ArticleAnalysisSchema>;
