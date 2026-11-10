import { z } from "zod";
export const CALENDAR_VERSION = "calendar-v2";
export const CalendarSourceSchema = z
  .object({
    id: z.string().max(100),
    kind: z.enum(["image", "attachment", "table"]),
    url: z.url(),
    locator: z.string().max(200),
    digest: z.string().max(100),
    text: z.string().max(24000),
    method: z.string().max(100),
  })
  .strict();
export const CalendarActivityMetaSchema = z
  .object({
    eligible: z.boolean(),
    reason: z.string().max(100),
    nature: z.enum([
      "announcement",
      "recruitment",
      "held",
      "recap",
      "award",
      "notice",
      "uncertain",
    ]),
    campus: z.enum(["university_town", "baiyun", "online", "unknown"]),
    candidateDates: z.array(z.string()).max(20),
    origins: z.array(CalendarSourceSchema.omit({ text: true })).max(4),
    usesBody: z.boolean(),
  })
  .strict();
export const CalendarReportSchema = z
  .object({
    version: z.enum(["calendar-v1", CALENDAR_VERSION]),
    status: z.enum(["accepted", "excluded", "needs_enrichment", "failed"]),
    reason: z.string().max(100),
    sources: z.array(CalendarSourceSchema).max(4),
    attempts: z.number().int().min(0).max(2).default(0),
  })
  .strict();
export const CalendarProposalSchema = z
  .object({
    events: z
      .array(
        z.object({
          title: z.string().max(300),
          sourceId: z.string().max(100),
          occurrenceQuote: z.string().min(1).max(1000),
          dates: z.array(z.string().min(1).max(100)).min(1).max(12),
          place: z.string().max(150).nullable(),
          organizer: z.string().max(100).nullable(),
          // Rules that collapse one timetable into several cards keep the same
          // reading title but need a separate identity per day.
          scope: z.string().max(100).optional(),
          nature: z.enum([
            "announcement",
            "recruitment",
            "held",
            "recap",
            "uncertain",
          ]),
        }),
      )
      // Matches the article schema: a real notice can list dozens of slots.
      .max(40),
  })
  .strict();
export type CalendarSource = z.infer<typeof CalendarSourceSchema>;
export type CalendarProposal = z.infer<typeof CalendarProposalSchema>;
