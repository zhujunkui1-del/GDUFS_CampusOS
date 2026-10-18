import { z } from "zod";
import {
  CommandSchema,
  ConsoleIdSchema,
  ContentInputSchema,
  SafeUrlSchema,
} from "./contracts";
export const ImportPolicySchema = CommandSchema.extend({
  rightsScope: z.enum([
    "metadata_only",
    "excerpt_and_link",
    "licensed_full_text",
  ]),
  evidenceUrls: z.array(SafeUrlSchema).min(1).max(5),
  note: z.string().trim().min(5).max(1000),
  validityDays: z.number().int().min(1).max(30).optional(),
  fullTextAuthorized: z.boolean().default(false),
})
  .strict()
  .refine(
    (v) => v.rightsScope === "metadata_only" || v.fullTextAuthorized,
    "请核实相应用途的内容许可。",
  );
export const ManualArticleSchema = ContentInputSchema.pick({
  title: true,
  url: true,
  publishedAt: true,
  sourceUpdatedAt: true,
  contentType: true,
  radarCategory: true,
  knowledgeCategory: true,
  campusScope: true,
  tags: true,
})
  .extend({
    body: z.string().max(50000).default(""),
    bodyStatus: z
      .enum(["not_provided", "partial", "complete"])
      .default("not_provided"),
    summary: z.string().trim().max(250).default(""),
    ownNoteConfirmed: z.boolean().default(false),
    originalChecked: z.boolean().optional(),
    discoveryUrls: z.array(SafeUrlSchema).max(5).default([]),
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (v) =>
      (!v.summary || v.ownNoteConfirmed) &&
      (v.bodyStatus === "not_provided" ? !v.body.trim() : !!v.body.trim()),
    "请核对正文状态与自有说明。",
  );
export const ManualImportSchema = z
  .object({
    commandId: z.string().uuid(),
    sourceId: ConsoleIdSchema,
    sourceVersion: z.number().int().positive(),
    items: z.array(ManualArticleSchema).min(1).max(2),
  })
  .strict();
