import { z } from "zod";
import {
  ContentTypeSchema,
  RightsScopeSchema,
  RadarCategorySchema,
  KnowledgeCategorySchema,
  TopicTagsSchema,
} from "./taxonomy";

export const SourceTypeSchema = z.enum([
  "official_web",
  "wechat_subscription",
  "wechat_service",
  "mini_program",
  "enterprise_wechat",
  "third_party_web",
  "student_media",
  "manual_import",
  "login_service",
  "embedded_app",
]);
export const CampusScopeSchema = z.enum([
  "university_town",
  "baiyun",
  "all",
  "online",
  "unknown",
]);
export const VerificationSchema = z.enum([
  "candidate",
  "pending",
  "verified",
  "rejected",
]);
export const OfficialStatusSchema = z.enum([
  "unverified",
  "claimed_official",
  "verified_official",
  "unofficial",
]);
export const PermissionSchema = z.enum([
  "unreviewed",
  "approved",
  "denied",
  "entry_only",
]);
export const ConsoleIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const SafeUrlSchema = z
  .url()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        ![...url.searchParams.keys()].some((key) =>
          /^(access_token|token|api_key|secret|password|session)$/i.test(key),
        )
      );
    } catch {
      return false;
    }
  }, "链接格式不受支持。");
export function safeExternalUrl(value: string | null | undefined) {
  const result = SafeUrlSchema.safeParse(value);
  return result.success ? result.data : null;
}
export const CatalogRefSchema = z
  .object({
    file: z.string().max(250),
    sheet: z.string().max(100).optional(),
    row: z.number().int().positive().optional(),
    line: z.number().int().positive().optional(),
    raw: z.string().max(5000).optional(),
  })
  .strict();
export const SourceInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    sourceAliases: z
      .array(z.string().trim().min(1).max(200))
      .max(30)
      .default([]),
    sourceType: SourceTypeSchema,
    subtype: z.string().max(200).default(""),
    organization: z.string().max(250).default(""),
    campusScope: CampusScopeSchema,
    websiteUrl: SafeUrlSchema.nullable(),
    wechatId: z
      .string()
      .trim()
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]{2,99}$/)
      .nullable(),
    evidenceUrls: z.array(SafeUrlSchema).max(40),
    priority: z.number().int().min(1).max(3),
    connectorType: z.enum([
      "disabled",
      "manual",
      "official_web",
      "wechat_link_manual",
      "entry_only",
    ]),
    connectorConfig: z
      .object({
        entryUrl: SafeUrlSchema.optional(),
        parserProfile: z.string().max(80).optional(),
      })
      .strict()
      .default({}),
    fetchPolicy: z
      .object({
        mode: z.enum(["disabled", "manual", "entry_only"]),
        maxRequests: z.number().int().min(0).max(10).default(0),
      })
      .strict(),
  })
  .strict();
export const CommandSchema = z
  .object({
    commandId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export const SourceEditSchema = SourceInputSchema.extend({
  commandId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
}).strict();
export const SourceVerifySchema = CommandSchema.extend({
  status: VerificationSchema,
  officialStatus: OfficialStatusSchema,
  permissionStatus: PermissionSchema,
  note: z.string().trim().min(5).max(1000),
  evidenceUrls: z.array(SafeUrlSchema).max(40),
  authorityConfirmed: z.boolean(),
}).strict();
export const SourceEnableSchema = CommandSchema.extend({
  enabled: z.boolean(),
}).strict();
export const PageQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    type: SourceTypeSchema.optional(),
    verification: VerificationSchema.optional(),
    official: OfficialStatusSchema.optional(),
    permission: PermissionSchema.optional(),
    enabled: z.enum(["0", "1"]).optional(),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z
      .enum([
        "pending",
        "approved",
        "returned",
        "rejected",
        "published",
        "withdrawn",
      ])
      .optional(),
  })
  .strict();
export const ExtractedFieldsSchema = z
  .object({
    organizer: z.string().max(200).nullable().optional(),
    startAt: z.iso.datetime({ offset: true }).nullable().optional(),
    endAt: z.iso.datetime({ offset: true }).nullable().optional(),
    registrationDeadline: z.iso
      .datetime({ offset: true })
      .nullable()
      .optional(),
    placeId: z.string().max(128).nullable().optional(),
    timeVerified: z.boolean().default(false),
    placeVerified: z.boolean().default(false),
    deadlineVerified: z.boolean().default(false),
  })
  .strict();
export const ContentInputSchema = z
  .object({
    sourceId: ConsoleIdSchema,
    title: z.string().trim().min(1).max(250),
    url: SafeUrlSchema,
    body: z.string().trim().min(1).max(50000),
    bodyStatus: z
      .enum(["unknown", "not_provided", "partial", "complete"])
      .default("unknown"),
    kind: z.enum(["knowledge", "event"]),
    campusScope: CampusScopeSchema,
    validUntil: z.iso.datetime({ offset: true }).nullable(),
    publishedAt: z
      .union([z.iso.datetime({ offset: true }), z.iso.date()])
      .nullable(),
    sourceUpdatedAt: z.iso.datetime({ offset: true }).nullable().default(null),
    contentType: ContentTypeSchema.default("unknown"),
    rightsScope: RightsScopeSchema.default("unknown"),
    radarCategory: RadarCategorySchema.nullable().default(null),
    knowledgeCategory: KnowledgeCategorySchema.nullable().default(null),
    publisher: z.string().trim().max(250).nullable().default(null),
    summary: z.string().trim().max(500).default(""),
    tags: TopicTagsSchema,
    extractedFields: ExtractedFieldsSchema,
  })
  .strict();
export const ContentWriteSchema = ContentInputSchema.extend({
  commandId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
}).strict();
export const ReviewSchema = CommandSchema.extend({
  decision: z.enum(["approved", "returned", "rejected"]),
  note: z.string().trim().min(2).max(1000),
}).strict();
export const PublishSchema = CommandSchema.extend({
  note: z.string().trim().min(2).max(1000),
}).strict();
export const RestoreSchema = CommandSchema.extend({
  version: z.number().int().positive(),
}).strict();
export type SourceInput = z.infer<typeof SourceInputSchema>;
export type ContentInput = z.infer<typeof ContentInputSchema>;
export type ConsoleRole = "admin" | "operator" | "reviewer";
export type ConsoleActor = { id: string; email: string; role: ConsoleRole };
export type SourceSummary = {
  id: string;
  displayName: string;
  sourceType: z.infer<typeof SourceTypeSchema>;
  organization: string;
  officialStatus: z.infer<typeof OfficialStatusSchema>;
  verificationStatus: z.infer<typeof VerificationSchema>;
  permissionStatus: z.infer<typeof PermissionSchema>;
  enabled: boolean;
  priority: number;
  version: number;
  updatedAt: string | null;
};
export type SourceDetail = SourceSummary &
  SourceInput & {
    originalCatalogRefs: z.infer<typeof CatalogRefSchema>[];
    catalogMetadata: Record<string, unknown>;
    lastCheckedAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    archivedAt: string | null;
  };
export type ContentSummary = {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  kind: "knowledge" | "event";
  version: number;
  reviewStatus: string;
  publicationStatus: string;
  url: string;
  validUntil: string | null;
};
export type ContentDetail = ContentSummary & {
  body: string;
  bodyStatus: "unknown" | "not_provided" | "partial" | "complete";
  discoveries?: { finder: string; entryUrl: string }[];
  timeEvidence?: {
    field: string;
    rawText: string;
    date: string | null;
    time: string | null;
    precision: string;
    inferred: boolean;
    snapshotVersion: number;
    contentRevision: number;
    verificationStatus: string;
  }[];
  campusScope: z.infer<typeof CampusScopeSchema>;
  extractedFields: z.infer<typeof ExtractedFieldsSchema>;
  publishedAt: string | null;
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  updatedAt: string | null;
  contentRevision: number;
  inputHash: string | null;
  contentType: string;
  rightsScope: string;
  radarCategory: string | null;
  knowledgeCategory: string | null;
  publisher: string | null;
  summary: string;
  tags: z.infer<typeof TopicTagsSchema>;
  eventCandidates: {
    id: string;
    title: string;
    organizer: string | null;
    startsAt: string | null;
    endsAt: string | null;
    registrationDeadline: string | null;
    rawPlaceName: string | null;
    verificationStatus: string;
  }[];
  duplicateOf: string | null;
  versions: { version: number; createdAt: string }[];
};
export const sourceTypeNames: Record<
  z.infer<typeof SourceTypeSchema>,
  string
> = {
  official_web: "官方网站",
  wechat_subscription: "公众号",
  wechat_service: "微信服务号",
  mini_program: "小程序",
  enterprise_wechat: "企业微信",
  third_party_web: "第三方网站",
  student_media: "学生社团自媒体",
  manual_import: "人工导入",
  login_service: "学校登录系统",
  embedded_app: "内嵌应用",
};
export const statusNames: Record<string, string> = {
  candidate: "候选",
  pending: "待审核",
  verified: "已核验",
  rejected: "已拒绝",
  returned: "已退回",
  approved: "已批准",
  published: "已发布",
  withdrawn: "已撤回",
  draft: "草稿",
  unverified: "未核实",
  claimed_official: "官方线索",
  verified_official: "已核实官方",
  unofficial: "非官方",
  unreviewed: "未审核许可",
  denied: "不准采集",
  entry_only: "仅服务入口",
};
