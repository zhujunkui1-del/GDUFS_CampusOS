import { z } from "zod";
import {
  VerificationSchema,
  PermissionSchema,
  OfficialStatusSchema,
  CommandSchema,
  SafeUrlSchema,
  SourceInputSchema,
  SourceEditSchema,
  SourceTypeSchema,
  CampusScopeSchema,
} from "./contracts";
export const SyncHoursSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(6),
  z.literal(12),
  z.literal(24),
]);
const GovernanceBase = CommandSchema.extend({
  affiliation: z.enum(["unknown", "confirmed", "unrelated"]),
  operating: z.enum(["unknown", "active", "paused", "closed", "unreachable"]),
  affiliationEvidence: z.array(SafeUrlSchema).max(10),
  operatingEvidence: z.array(SafeUrlSchema).max(10),
  note: z.string().trim().min(5).max(1000),
  enabled: z.boolean(),
  retainHistory: z.boolean().default(true),
}).strict();
const validGovernance = (v: {
  affiliation: string;
  operating: string;
  affiliationEvidence: string[];
  operatingEvidence: string[];
  enabled: boolean;
}) =>
  (v.affiliation !== "confirmed" || v.affiliationEvidence.length > 0) &&
  (v.operating !== "active" || v.operatingEvidence.length > 0) &&
  (!v.enabled || (v.affiliation === "confirmed" && v.operating === "active"));
export const GovernanceSchema = GovernanceBase.refine(
  validGovernance,
  "请核对广外关联与当前运营证据。",
);
export const SourceCreateV2Schema = SourceInputSchema.extend({
  commandId: z.string().uuid(),
  miniProgramId: z.string().trim().max(100).nullable().default(null),
  sourceNote: z.string().max(1000).default(""),
  governance: GovernanceBase.omit({ commandId: true, expectedVersion: true })
    .refine(validGovernance, "请核对广外关联与当前运营证据。")
    .optional(),
}).strict();
export const SourceEditV2Schema = SourceEditSchema.extend({
  miniProgramId: z.string().max(100).nullable().optional(),
  sourceNote: z.string().max(1000).optional(),
}).strict();
export const EngineSettingsSchema = CommandSchema.extend({
  syncHours: SyncHoursSchema,
  autoSync: z.boolean(),
  networkBudget: z.number().int().min(2).max(20),
  earliestImportDay: z.iso.date().nullable(),
  confirmImportCutoff: z.boolean().default(false),
  note: z.string().trim().min(2).max(1000),
}).strict();
export const SourceSyncSchema = CommandSchema.extend({
  hours: SyncHoursSchema.nullable(),
  note: z.string().min(2).max(1000),
}).strict();
export const SourcesV2Query = z
  .object({
    q: z.string().trim().max(100).optional(),
    verification: VerificationSchema.optional(),
    permission: PermissionSchema.optional(),
    official: OfficialStatusSchema.optional(),
    type: SourceTypeSchema.optional(),
    organization: z.string().max(100).optional(),
    campus: CampusScopeSchema.optional(),
    state: z.enum(["enabled", "paused", "closed", "archived"]).optional(),
    affiliation: z.enum(["unknown", "confirmed", "unrelated"]).optional(),
    operating: z
      .enum(["unknown", "active", "paused", "closed", "unreachable"])
      .optional(),
    automatic: z.enum(["1", "0"]).optional(),
    error: z.enum(["1", "0"]).optional(),
    protected: z.enum(["1", "0"]).optional(),
    updatedAfter: z.iso.date().optional(),
    updatedBefore: z.iso.date().optional(),
    minArticles: z.coerce.number().int().min(0).optional(),
    maxArticles: z.coerce.number().int().min(0).optional(),
    sort: z
      .enum(["name", "updated", "articles", "next_sync"])
      .default("updated"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const ArticleV2Query = z
  .object({
    titleOnly: z.enum(["1"]).optional(),
    q: z.string().max(100).optional(),
    sourceId: z.string().max(100).optional(),
    type: z.string().max(40).optional(),
    category: z.string().max(50).optional(),
    tag: z.string().max(50).optional(),
    campus: CampusScopeSchema.optional(),
    review: z
      .enum(["pending", "approved", "returned", "rejected", "unapproved"])
      .optional(),
    publication: z.enum(["draft", "published", "withdrawn"]).optional(),
    publishedAfter: z.iso.date().optional(),
    publishedBefore: z.iso.date().optional(),
    fetchedAfter: z.iso.date().optional(),
    fetchedBefore: z.iso.date().optional(),
    body: z.enum(["unknown", "not_provided", "partial", "complete"]).optional(),
    expired: z.enum(["1", "0"]).optional(),
    protected: z.enum(["1", "0"]).optional(),
    eventAfter: z.iso.date().optional(),
    eventBefore: z.iso.date().optional(),
    deadline: z.enum(["open", "closed", "unknown"]).optional(),
    issues: z.enum(["1", "0"]).optional(),
    severity: z.enum(["warning", "error"]).optional(),
    issue: z.string().max(60).optional(),
    sort: z.enum(["updated", "published", "title"]).default("updated"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export type Governance = z.infer<typeof GovernanceSchema>;
export type SourceV2 = {
  verificationStatus: z.infer<typeof VerificationSchema>;
  permissionStatus: z.infer<typeof PermissionSchema>;
  officialStatus: z.infer<typeof OfficialStatusSchema>;
  id: string;
  displayName: string;
  sourceType: z.infer<typeof SourceTypeSchema>;
  organization: string;
  campusScope: string;
  websiteUrl: string | null;
  wechatId: string | null;
  miniProgramId: string | null;
  sourceNote: string;
  affiliation: string;
  operating: string;
  enabled: boolean;
  registeredEnabled: boolean;
  version: number;
  automatic: boolean;
  lastSuccessAt: string | null;
  nextSyncAt: number | null;
  syncHours: number;
  syncOverride: number | null;
  syncState: string;
  articleCount: number;
  publishedCount: number;
  lastError: string | null;
  protected: boolean;
  governanceCheckedAt: string | null;
  affiliationEvidence: string[];
  operatingEvidence: string[];
  governanceNote: string;
  retainHistory: boolean;
};
