// Existing isolated preview only. Read-only default; only audited additive 0012/0013.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";
const config = parse(readFileSync("wrangler.jsonc", "utf8")),
  account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(config, account);
const id = config.env.preview.d1_databases[0].database_id;
const currentWebRule = readFileSync(
  "src/lib/ingestion/profiles.ts",
  "utf8",
).match(/const ruleVersion = "([a-z0-9.-]+)";/)?.[1];
if (!currentWebRule) throw Error("Web parser version unavailable");
const labelArg = process.argv.find((s) => s.startsWith("--label="));
const label =
  labelArg?.slice(8) ||
  (process.argv.includes("--migrate") ? "migration" : "readonly");
if (!/^[a-z0-9-]+$/.test(label)) throw Error("Invalid evidence label");
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(auth.slice(auth.indexOf("{")));
const call = (path, body) =>
  previewCloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
    token,
    body,
  );
const db = await call("/d1/database/" + id);
if (db.name !== "campusos-preview" || db.uuid !== id)
  throw Error("Preview identity mismatch");
const queryStats = [];
async function query(sql, params = []) {
  if (!/^(SELECT |PRAGMA foreign_key_check$)/.test(sql))
    throw Error("Read-only query required");
  const start = performance.now();
  const [result] = await call(`/d1/database/${id}/query`, { sql, params });
  queryStats.push({
    ordinal: queryStats.length + 1,
    wallTimeMs: Math.round(performance.now() - start),
    durationMs: result.meta?.duration ?? null,
    rowsRead: result.meta?.rows_read ?? null,
    rowsWritten: result.meta?.rows_written ?? null,
  });
  return result.results;
}
const migrations = async () =>
  (await query("SELECT name FROM d1_migrations ORDER BY id")).map(
    (r) => r.name,
  );
const counts = async () =>
  (
    await query(
      "SELECT (SELECT count(*) FROM knowledge_sources) AS sources,(SELECT count(*) FROM knowledge_sources WHERE verification_status='verified') AS verified,(SELECT count(*) FROM knowledge_sources WHERE enabled=1) AS enabled,(SELECT count(*) FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private') AS documents,(SELECT count(*) FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private' AND review_status='approved') AS approved,(SELECT count(*) FROM console_public_documents) AS published,(SELECT count(*) FROM ingestion_jobs) AS jobs,(SELECT count(*) FROM campus_events) AS events,(SELECT count(*) FROM conversations) AS conversations,(SELECT count(*) FROM conversation_messages) AS messages,(SELECT count(*) FROM agent_runs) AS runs",
    )
  ).at(0);
const sourceStates = async () =>
  createHash("sha256")
    .update(
      JSON.stringify(
        await query(
          "SELECT id,version,enabled,verification_status,official_status,permission_status,authorization_status FROM knowledge_sources ORDER BY id",
        ),
      ),
    )
    .digest("hex");
mkdirSync("docs/verification/s3-b-final", { recursive: true });
const before = {
  recordedAt: new Date().toISOString(),
  counts: await counts(),
  sourceVerificationCounts: await query(
    "SELECT verification_status,enabled,count(*) AS n FROM knowledge_sources WHERE console_managed=1 AND source_type<>'user_private' AND archived_at IS NULL GROUP BY verification_status,enabled ORDER BY verification_status,enabled",
  ),
  migrations: await migrations(),
  sourceStateHash: await sourceStates(),
};
const file = "0012_manual_intake_and_evidence.sql",
  pending = readdirSync("migrations").filter(
    (f) => f.endsWith(".sql") && !before.migrations.includes(f),
  );
if (
  pending.some((f) => ![file, "0013_content_edit_intake_guard.sql"].includes(f))
)
  throw Error("Unreviewed pending migration");
if (process.argv.includes("--migrate") && pending.length) {
  const checks = JSON.parse(
    readFileSync("docs/verification/s3-b-final/database-tests.json", "utf8"),
  );
  for (const migration of pending) {
    const sql =
      readFileSync("migrations/" + migration, "utf8")
        .replace(/\r\n/g, "\n")
        .trimEnd() + "\n";
    if (
      !checks.emptyMigrationPassed ||
      !checks.populatedUpgradePassed ||
      !checks.incremental0012UpgradePassed ||
      !checks.failedMigrationRollbackPassed ||
      !checks.privateDataAndSnapshotsPreserved ||
      /\b(DROP|DELETE|REPLACE)\s+(TABLE|FROM|INTO)\b/i.test(sql) ||
      !checks.migrations.some(
        (m) =>
          m.file === migration &&
          m.sha256 === createHash("sha256").update(sql).digest("hex"),
      )
    )
      throw Error("Passing exact local migration evidence required");
  }
  writeFileSync(
    `docs/verification/s3-b-final/preview-before-${label}.json`,
    JSON.stringify(before, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({ target: "campusos-preview", databaseId: id, pending }),
  );
  const run = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "migrations",
      "apply",
      "campusos-preview",
      "--remote",
      "--config",
      "wrangler.jsonc",
      "--env",
      "preview",
    ],
    {
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  if (run.status !== 0)
    throw Error("Migration failed; database retained, no destructive retry");
}
const appliedNames = await migrations();
const applied = [file, "0013_content_edit_intake_guard.sql"].every((f) =>
  appliedNames.includes(f),
);
const report = {
  recordedAt: new Date().toISOString(),
  realCloud: true,
  target: "campusos-preview",
  before,
  counts: await counts(),
  migrations: await migrations(),
  sourceStatesPreserved: before.sourceStateHash === (await sourceStates()),
  foreignKeyViolations: (await query("PRAGMA foreign_key_check")).length,
  documents: await query(
    "SELECT id,source_id,title,url,published_at,version,review_status,publication_status,rights_scope FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private' ORDER BY id LIMIT 20",
  ),
  bodyAvailable: applied
    ? (
        await query(
          "SELECT count(*) AS n FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private' AND body_status IN('partial','complete') AND rights_scope IN('excerpt_and_link','licensed_full_text')",
        )
      ).at(0).n
    : 0,
  currentWebRule,
  activeWebPoliciesAtCurrentRule: (
    await query(
      "SELECT count(*) AS n FROM source_collection_policies p JOIN knowledge_sources s ON s.id=p.source_id WHERE p.rule_version=? AND p.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AND s.enabled=1 AND s.verification_status='verified' AND s.permission_status='approved' AND s.authorization_status='approved' AND s.archived_at IS NULL",
      [currentWebRule],
    )
  ).at(0).n,
  verifiedEventTimes: (
    await query(
      "SELECT count(*) AS n FROM event_candidates WHERE verification_status='verified' AND starts_at IS NOT NULL",
    )
  ).at(0).n,
  recentContentDecisions: await query(
    "SELECT a.action,a.target_id,a.version,a.created_at FROM console_audit_logs a JOIN knowledge_documents d ON d.id=a.target_id WHERE a.target_type='document' AND a.action IN('document.review','document.publish','document.withdraw') AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' ORDER BY a.created_at DESC,a.id DESC LIMIT 10",
  ),
  workerVersions: (await call("/workers/scripts/campusos-preview/deployments"))
    .deployments?.[0]?.versions,
  migrationAppliedByThisRun:
    process.argv.includes("--migrate") && pending.length > 0,
  contentReviewedOrPublishedByThisRun: false,
  queryStats,
  queryStatsScope:
    "Read-only D1 management API observations, not Worker CPU or public API query timings",
};
writeFileSync(
  `docs/verification/s3-b-final/preview-${label}.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    counts: report.counts,
    applied,
    foreignKeyViolations: report.foreignKeyViolations,
    sourceStatesPreserved: report.sourceStatesPreserved,
    documents: report.documents.map((d) => ({ id: d.id, title: d.title })),
  }),
);
if (!report.sourceStatesPreserved || report.foreignKeyViolations)
  process.exitCode = 1;
