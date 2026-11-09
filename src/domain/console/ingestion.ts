import { z } from "zod";
import { CommandSchema, ContentInputSchema, SafeUrlSchema } from "./contracts";
export const CheckpointSchema = z
  .object({
    urls: z.array(SafeUrlSchema).max(50).default([]),
    publishedDates: z
      .array(
        z
          .object({ url: SafeUrlSchema, publishedAt: z.iso.date().nullable() })
          .strict(),
      )
      .max(50)
      .default([]),
    index: z.number().int().min(0).max(50).default(0),
    page: SafeUrlSchema.nullable().default(null),
    pagesSeen: z.array(SafeUrlSchema).max(10).default([]),
    visitedPageHashes: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .max(100)
      .default([]),
    entryIndex: z.number().int().min(0).max(49).default(0),
    pageCount: z.number().int().min(0).default(0),
    revalidate: z.boolean().default(false),
    // How many pages in a row came back broken. A run with a handful of
    // unreadable pages out of dozens is normal; only a run of them means the
    // source itself is gone.
    errorStreak: z.number().int().min(0).default(0),
  })
  .strict();
export const PolicySchema = CommandSchema.extend({
  ruleVersion: z.string().max(80),
  rightsScope: z.enum([
    "metadata_only",
    "excerpt_and_link",
    "licensed_full_text",
  ]),
  fullTextAuthorized: z.boolean().default(false),
  evidenceUrls: z.array(SafeUrlSchema).min(1).max(10),
  note: z.string().min(5).max(1000),
  validityDays: z.number().int().min(1).max(36500).optional(),
  robotsStatus: z.union([z.literal(200), z.literal(404)]),
  robotsHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
})
  .strict()
  .refine(
    (v) => v.rightsScope === "metadata_only" || v.fullTextAuthorized,
    "需要明确确认相应正文使用许可。",
  );
export const CreateJobSchema = z
  .object({
    commandId: z.string().uuid(),
    sourceId: z.string().regex(/^[\w-]{1,100}$/),
    maxArticles: z.number().int().min(1).max(2).default(2),
    mode: z.enum(["incremental", "revalidate"]).default("incremental"),
  })
  .strict();
export const LeaseSchema = CommandSchema.extend({
  leaseToken: z.string().uuid(),
  fence: z.number().int().positive(),
}).strict();
export const TimeEvidenceSchema = z
  .object({
    field: z.enum(["startsAt", "endsAt", "registrationDeadline"]),
    rawText: z.string().min(1).max(150),
    startOffset: z.number().int().min(0).max(50000),
    endOffset: z.number().int().min(1).max(50000),
    date: z.iso.date().nullable(),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}:\d{2}$/)
      .nullable(),
    precision: z.enum(["unknown", "date", "exact_time"]),
    inferred: z.literal(false),
    verificationStatus: z.literal("pending"),
  })
  .strict();
export const EventCandidateSchema = z
  .object({
    title: z.string().min(1).max(250),
    organizer: z.string().max(250).nullable(),
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
    registrationDeadline: z.iso.datetime({ offset: true }).nullable(),
    registrationUrl: SafeUrlSchema.nullable(),
    rawPlaceName: z.string().max(200).nullable(),
    campusScope: z.enum([
      "all",
      "university_town",
      "baiyun",
      "online",
      "unknown",
    ]),
    audience: z.string().max(250).nullable(),
    changeStatus: z.enum(["unknown", "cancelled", "postponed"]),
    timeEvidence: z.array(TimeEvidenceSchema).max(3).default([]),
  })
  .strict();
export const CommitStepSchema = LeaseSchema.extend({
  url: SafeUrlSchema,
  status: z.number().int().min(0).max(599),
  bytes: z.number().int().min(0).max(524288),
  requests: z.number().int().min(0).max(2),
  outcome: z.enum([
    "ok",
    "not_modified",
    "parse_error",
    "too_large",
    "blocked",
    "network_error",
  ]),
  etag: z.string().max(200).nullable(),
  lastModified: z.string().max(200).nullable(),
  bodyHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  publishedRaw: z.string().max(100).nullable(),
  bodyTextChars: z.number().int().min(0).max(50000).default(0),
  discovered: z.array(SafeUrlSchema).max(50).default([]),
  discoveredDates: z
    .array(
      z
        .object({ url: SafeUrlSchema, publishedAt: z.iso.date().nullable() })
        .strict(),
    )
    .max(50)
    .default([]),
  nextPage: SafeUrlSchema.nullable().default(null),
  article: ContentInputSchema.nullable().default(null),
  events: z.array(EventCandidateSchema).max(3).default([]),
  attachments: z
    .array(z.object({ url: SafeUrlSchema, name: z.string().max(200) }).strict())
    .max(3)
    .default([]),
}).strict();
export const ChunkSchema = z
  .object({
    text: z.string().min(1).max(800),
    startOffset: z.number().int().min(0).max(50000),
    endOffset: z.number().int().min(1).max(50000),
  })
  .strict();
export const IngestionResultSchema = CommitStepSchema.extend({
  chunks: z.array(ChunkSchema).max(3).default([]),
}).strict();
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export type CommitStep = z.infer<typeof CommitStepSchema>;
export type EventCandidate = z.infer<typeof EventCandidateSchema>;
