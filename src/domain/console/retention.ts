import { z } from "zod";
import { CommandSchema, ConsoleIdSchema, SourceTypeSchema } from "./contracts";
export const ProtectionSchema = CommandSchema.extend({
  type: z.enum(["source", "document"]),
  targetId: ConsoleIdSchema,
  active: z.boolean(),
  historyExempt: z.boolean().default(false),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  reason: z.string().trim().min(5).max(500),
}).strict();
export const ProtectionQuery = z
  .object({
    category: z.string().max(50).optional(),
    operating: z
      .enum(["unknown", "active", "paused", "closed", "unreachable"])
      .optional(),
    permanent: z.enum(["1", "0"]).optional(),
    addedAfter: z.iso.date().optional(),
    expiresBefore: z.iso.date().optional(),
    sort: z.enum(["updated", "expires", "title"]).default("updated"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    q: z.string().max(100).optional(),
    type: z.enum(["source", "document"]).optional(),
    status: z.enum(["active", "expired", "removed"]).default("active"),
    sourceType: SourceTypeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const RetentionFilters = z
  .object({
    cutoff: z.iso.date(),
    sourceId: ConsoleIdSchema.optional(),
    sourceType: SourceTypeSchema.optional(),
    q: z.string().max(100).optional(),
    category: z.string().max(50).optional(),
    tag: z.string().max(50).optional(),
    publication: z.enum(["draft", "published", "withdrawn"]).optional(),
    body: z.enum(["unknown", "not_provided", "partial", "complete"]).optional(),
  })
  .strict();
export const RetentionCreate = z
  .object({ commandId: z.string().uuid(), filters: RetentionFilters })
  .strict();
export const RetentionAction = CommandSchema.extend({
  action: z.enum(["scan", "mark", "purge", "pause", "resume"]),
  confirmation: z.string().max(150).optional(),
}).strict();
