// Dry-run by default. SQL plans are local artifacts, never a public SQL API.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { build } from "esbuild";
import { createRequire } from "node:module";
const dir =
  process.env.CONSOLE_IMPORT_REPORT_DIR || "docs/verification/s3-a/import";
mkdirSync(dir, { recursive: true });
mkdirSync("test-results", { recursive: true });
await build({
  entryPoints: ["src/domain/console/contracts.ts"],
  outfile: "test-results/console-catalog-contracts.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
  tsconfig: "tsconfig.json",
});
const require = createRequire(import.meta.url),
  { SourceInputSchema, SafeUrlSchema } = require(
    resolve("test-results/console-catalog-contracts.cjs"),
  );
const raw = JSON.parse(
  execFileSync("python", ["scripts/read-source-catalog.py"], {
    encoding: "utf8",
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    maxBuffer: 8 * 1024 * 1024,
  }),
);
const warnings = [],
  errors = [],
  records = [],
  identities = new Map(),
  sameNames = new Map();
const kinds = {
  官网: "official_web",
  公众号: "wechat_subscription",
  服务号: "wechat_service",
  小程序: "mini_program",
  企业微信: "enterprise_wechat",
  内嵌应用: "embedded_app",
};
const urls = (text) => [
  ...new Set(
    (String(text).match(/https?:\/\/[^\s；;<>）]+/g) || []).map((value) =>
      value.replace(/[。。，,]+$/, ""),
    ),
  ),
];
const validUrls = (text, id) =>
  urls(text).filter((value) => {
    if (SafeUrlSchema.safeParse(value).success) return true;
    warnings.push({ sourceId: id, code: "INVALID_URL_RETAINED_IN_RAW", value });
    return false;
  });
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
for (const row of raw.sheets["全渠道去重总表"].slice(1)) {
  const c = row.cells,
    id = c.A,
    head = raw.markdownHeads[id];
  if (!/^GDUFS-SRC-\d{4}$/.test(id || "") || !head || head.name !== c.D) {
    errors.push({ id, row: row.row, code: "CATALOG_MD_XLSX_MISMATCH" });
    continue;
  }
  let type = kinds[c.B];
  if (!type) {
    errors.push({ id, code: "UNKNOWN_CHANNEL" });
    continue;
  }
  if (
    c.B === "官网" &&
    /教务管理系统|统一身份|网上办事|智慧校园门户|数智广外/.test(c.D)
  )
    type = "login_service";
  const primary = validUrls(c.I, id),
    evidence = [
      ...new Set([
        ...validUrls(c.L, id),
        ...validUrls(c.M, id),
        ...(c.B !== "官网" ? primary : []),
      ]),
    ];
  const wechat = (c.J || "").trim(),
    wechatId = /^[a-zA-Z][a-zA-Z0-9_-]{2,99}$/.test(wechat) ? wechat : null;
  if (["公众号", "服务号"].includes(c.B) && !wechatId)
    warnings.push({
      sourceId: id,
      code: wechat ? "WECHAT_ID_CONFLICT_OR_UNVERIFIED" : "MISSING_WECHAT_ID",
      raw: wechat,
    });
  const aliases =
    (c.S || "")
      .match(/名称别名：([^；]+)/g)
      ?.map((value) => value.slice(5).trim())
      .filter(Boolean) || [];
  const campusScope =
    c.N === "大学城"
      ? "university_town"
      : c.N === "白云山"
        ? "baiyun"
        : /全校/.test(c.N)
          ? "all"
          : /线上/.test(c.N)
            ? "online"
            : "unknown";
  const input = {
    displayName: c.D,
    sourceAliases: aliases,
    sourceType: type,
    subtype: c.C || "",
    organization: c.E || "",
    campusScope,
    websiteUrl: c.B === "官网" ? primary[0] || null : null,
    wechatId,
    evidenceUrls: evidence.slice(0, 40),
    priority: Number((c.R || "P3").replace("P", "")),
    connectorType: type === "login_service" ? "entry_only" : "disabled",
    connectorConfig: {},
    fetchPolicy: {
      mode: type === "login_service" ? "entry_only" : "disabled",
      maxRequests: 0,
    },
  };
  const parsed = SourceInputSchema.safeParse(input);
  if (!parsed.success) {
    errors.push({
      id,
      row: row.row,
      code: "SCHEMA_INVALID",
      fields: parsed.error.issues.map((x) => x.path.join(".")),
    });
    continue;
  }
  let locator = null;
  if (input.websiteUrl) {
    const url = new URL(input.websiteUrl);
    url.hash = "";
    locator = url.toString().replace(/\/$/, "");
  } else if (
    ["wechat_subscription", "wechat_service"].includes(type) &&
    wechatId
  )
    locator = wechatId.toLowerCase();
  const identity = locator ? type + ":" + locator : null;
  if (identity && identities.has(identity)) {
    errors.push({
      id,
      other: identities.get(identity),
      code: "DUPLICATE_SAME_CHANNEL",
    });
  } else if (identity) identities.set(identity, id);
  const nameKey = c.D.normalize("NFKC").replace(/\s/g, "").toLowerCase();
  const group = sameNames.get(nameKey) || [];
  group.push({ id, channel: type });
  sameNames.set(nameKey, group);
  const refs = [
    { file: raw.files[0].file, sheet: "全渠道去重总表", row: row.row },
    { file: raw.files[1].file, line: head.line },
    ...(c.T || "")
      .split("；")
      .filter(Boolean)
      .map((part) => ({ file: part.split("｜")[0], raw: part })),
  ];
  const metadata = {
    catalogStatus: c.G,
    accountVerificationClaim: c.H,
    claimedNature: c.F,
    claimedWebsiteOrEvidence: c.I,
    claimedWechatId: c.J,
    contentScope: c.K,
    accessBoundary: c.O,
    radarSuggestion: c.P,
    ragSuggestion: c.Q,
    notes: c.S,
  };
  const record = {
    id,
    input: parsed.data,
    officialStatus: /非官方/.test(c.F || "")
      ? "unofficial"
      : /官方|学校/.test(c.F || "")
        ? "claimed_official"
        : "unverified",
    canonicalLocator: locator,
    originalCatalogRefs: refs,
    catalogMetadata: metadata,
  };
  records.push({ ...record, catalogHash: hash(record) });
}
const namedGroups = [...sameNames.values()].filter((group) => group.length > 1);
const conflicts = raw.sheets["重复冲突与待核事项"]
  .slice(1)
  .map((row) => ({ row: row.row, ...row.cells }));
for (const record of records)
  if (
    /冲突|认证主体|独立主体|名称相似/.test(record.catalogMetadata.notes || "")
  )
    warnings.push({
      sourceId: record.id,
      code: "AUTHORITY_CLAIM_REQUIRES_HUMAN_REVIEW",
    });
const manifest = { version: "2026-10-17", files: raw.files, records };
const report = {
  recordedAt: new Date().toISOString(),
  dryRun: true,
  passed: errors.length === 0,
  originalRows: raw.sheets["全渠道去重总表"].length - 1,
  mdRecords: Object.keys(raw.markdownHeads).length,
  mappedRecords: records.length,
  sourceTypes: Object.fromEntries(
    [...new Set(records.map((r) => r.input.sourceType))].map((type) => [
      type,
      records.filter((r) => r.input.sourceType === type).length,
    ]),
  ),
  sameNameDifferentChannels: namedGroups,
  conflictCatalog: conflicts,
  warnings,
  errors,
  manifestHash: hash(manifest),
  enabled: 0,
  verified: 0,
  allCandidates: true,
  automaticCollection: false,
  files: raw.files,
  fieldMapping: {
    A: "source_id",
    B: "channel_type",
    C: "subtype",
    D: "display_name",
    E: "organization",
    F: "claimed authority only",
    G: "catalog activity claim only",
    H: "account verification claim only",
    I: "website for web channels; evidence for WeChat",
    J: "wechat_id if unambiguous",
    L: "evidence_urls",
    N: "campus_scope",
    R: "priority clue",
    S: "aliases/notes",
    T: "original_catalog_refs",
  },
};
writeFileSync(`${dir}/dry-run.json`, JSON.stringify(report, null, 2) + "\n");
if (report.passed) {
  mkdirSync("data/console", { recursive: true });
  writeFileSync(
    "data/console/source-catalog-2026-10-17.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify({
    dryRun: true,
    passed: report.passed,
    originalRows: report.originalRows,
    records: records.length,
    errors: errors.length,
    warnings: warnings.length,
    sameNameGroups: namedGroups.length,
    conflictRows: conflicts.length,
    enabled: 0,
  }),
);
if (!report.passed) process.exitCode = 1;
