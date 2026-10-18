import { z } from "zod";
import { CommandSchema, SafeUrlSchema } from "./contracts";
import { KnowledgeCategorySchema } from "./taxonomy";
export const AutoPolicySchema = CommandSchema.extend({
  enabled: z.boolean(),
  rightsScope: z.enum([
    "metadata_only",
    "excerpt_and_link",
    "licensed_full_text",
  ]),
  defaultCategory: KnowledgeCategorySchema,
  unknownDate: z.enum(["review", "metadata_unknown"]),
  allowUnofficial: z.boolean().default(false),
  validityDays: z.number().int().min(1).max(30),
  evidenceUrls: z.array(SafeUrlSchema).min(1).max(5),
  note: z.string().trim().min(5).max(1000),
}).strict();
export const AttestationSchema = CommandSchema.extend({
  evidenceUrls: z.array(SafeUrlSchema).min(1).max(5),
  note: z.string().trim().min(5).max(1000),
}).strict();
