import { z } from "zod";
import { RetrievalResultSchema, RetrievalQuerySchema } from "./contracts";
import { ArticleTimePointSchema } from "@/domain/console/article-analysis";
import { RadarCategorySchema } from "@/domain/console/taxonomy";

export const KnowledgeSearchInputSchema = RetrievalQuerySchema.omit({
  purpose: true,
  documentIds: true,
})
  .extend({ limit: z.number().int().min(1).max(4).default(3) })
  .strict();
export const EventSearchInputSchema = KnowledgeSearchInputSchema.extend({
  limit: z.number().int().min(1).max(6).default(4),
  category: RadarCategorySchema.optional(),
  after: z.iso.date().optional(),
  before: z.iso.date().optional(),
  timeRole: z.enum(["event", "registration"]).default("event"),
  // A follow-up ("还有吗") must page past the rows already shown, otherwise
  // every page repeats the same list.
  excludeDocumentIds: z.array(z.string().max(128)).max(40).optional(),
  // A browse inside a time box ("最近两周有哪些讲座") may fall back to the
  // nearest upcoming items when the box is empty. An explicit date filter
  // ("11月1日到11月5日") must stay strict, so this is opt-in.
  nearestIfEmpty: z.boolean().optional(),
  registrationState: z
    .enum([
      "open",
      "not_started",
      "closed",
      "not_required",
      "unknown",
      "capacity_unknown",
    ])
    .optional(),
}).strict();
export const RetrievalTimeSchema = ArticleTimePointSchema.pick({
  raw: true,
  date: true,
  at: true,
  timezone: true,
  precision: true,
  resolution: true,
  inferred: true,
  inferenceBasis: true,
})
  .extend({ evidence: z.string().max(240) })
  .strict();
export const RegistrationNowSchema = z.enum([
  "open",
  "not_started",
  "closed",
  "not_required",
  "unknown",
  "capacity_unknown",
]);
export const RetrievedActivitySchema = z
  .object({
    eventId: z.string(),
    documentId: z.string(),
    activityKey: z.string(),
    name: z.string().max(250),
    kind: z.enum(["event", "opportunity", "notice"]),
    category: RadarCategorySchema.nullable(),
    startsAt: RetrievalTimeSchema.nullable(),
    endsAt: RetrievalTimeSchema.nullable(),
    placeRaw: z.string().max(300).nullable(),
    organizer: z.string().max(300).nullable(),
    eventStatus: z.string(),
    historical: z.boolean(),
    registrationRequirement: z.enum(["required", "not_required", "unknown"]),
    registrationState: RegistrationNowSchema,
    registrationWindows: z
      .array(
        z.object({
          roundLabel: z.string().nullable(),
          start: RetrievalTimeSchema.nullable(),
          end: RetrievalTimeSchema.nullable(),
          deadlineSemantics: z.string(),
          capacityLimited: z.boolean(),
          state: RegistrationNowSchema,
          evidence: z.array(z.string().max(240)).max(2),
        }),
      )
      .max(3),
    otherDeadlines: z
      .array(z.object({ role: z.string(), time: RetrievalTimeSchema }))
      .max(3),
    registrationUrl: z.string().nullable(),
    evidence: z.array(z.string().max(240)).max(3),
    mapPlace: z
      .object({
        placeId: z.string(),
        name: z.string(),
        precision: z.literal("building"),
      })
      .nullable(),
    calendarUrl: z.string().optional(),
  })
  .strict();
export const ContentSearchResultSchema = RetrievalResultSchema.extend({
  purpose: z.enum(["knowledge", "events"]),
  query: z.string().max(300),
  now: z.string(),
  timeZone: z.literal("Asia/Shanghai"),
  activities: z.array(RetrievedActivitySchema).max(12),
  knowledge: z
    .array(
      z.object({
        documentId: z.string(),
        validity: z.enum(["current", "historical", "expired", "unknown"]),
        effectiveFrom: RetrievalTimeSchema.nullable(),
        effectiveUntil: RetrievalTimeSchema.nullable(),
        conditions: z.array(z.string().max(300)).max(3),
        materials: z.array(z.string().max(300)).max(3),
        steps: z.array(z.string().max(300)).max(3),
      }),
    )
    .max(6),
}).strict();
export type ContentSearchResult = z.infer<typeof ContentSearchResultSchema>;
