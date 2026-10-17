// Read-only by default; --apply migrates only reviewed additive 0007–0011 on existing preview.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";
const config = parse(readFileSync("wrangler.jsonc", "utf8")),
  account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(config, account);
const id = config.env.preview.d1_databases[0].database_id;
const cli = (...args) => {
  try {
    const output = execFileSync(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", ...args, "--json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const start = output.indexOf("{");
    if (start < 0) throw Error("Missing structured CLI output");
    return JSON.parse(output.slice(start));
  } catch {
    throw Error(
      "Cloudflare authentication unavailable; credentials/output withheld",
    );
  }
};
// Exact account namespace + database UUID/name below provide the ownership check; no membership-list request is needed.
const { token } = cli("auth", "token");
const call = (path, body) =>
  previewCloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
    token,
    body,
  );
const target = await call("/d1/database/" + id);
if (target.name !== "campusos-preview" || target.uuid !== id)
  throw Error("Database identity mismatch");
const sql = async (query) => {
  if (!/^(SELECT|PRAGMA foreign_key_check)/i.test(query))
    throw Error("Read-only query required");
  return (await call(`/d1/database/${id}/query`, { sql: query, params: [] }))[0]
    .results;
};
const counts = async () =>
  (
    await sql(
      "SELECT (SELECT count(*) FROM knowledge_sources) AS sources,(SELECT count(*) FROM knowledge_documents) AS documents,(SELECT count(*) FROM ingestion_jobs) AS jobs,(SELECT count(*) FROM conversations) AS conversations,(SELECT count(*) FROM conversation_messages) AS messages,(SELECT count(*) FROM agent_runs) AS runs",
    )
  )[0];
const sources = async () =>
  await sql(
    "SELECT id,version,verification_status,official_status,permission_status,authorization_status,enabled FROM knowledge_sources ORDER BY id",
  );
const before = await counts(),
  beforeSources = JSON.stringify(await sources()),
  migrationBefore = (
    await sql("SELECT name FROM d1_migrations ORDER BY id")
  ).map((x) => x.name);
const approved = [
    "0007_content_contract.sql",
    "0008_ingestion_pipeline.sql",
    "0009_ingestion_clock_guards.sql",
    "0010_document_topics.sql",
    "0011_ingestion_daily_budget.sql",
  ],
  pending = approved.filter((x) => !migrationBefore.includes(x));
let applied = false;
if (process.argv.includes("--apply")) {
  const checks = JSON.parse(
    readFileSync("docs/verification/s3-b/database-tests.json", "utf8"),
  );
  if (
    !checks.emptyMigrationPassed ||
    !checks.populatedUpgradePassed ||
    !checks.failedBatchRollbackPassed ||
    !checks.privateDataAndSnapshotsPreserved
  )
    throw Error("Passing local compatibility checks required");
  for (const file of approved) {
    const sha = createHash("sha256")
      .update(
        readFileSync("migrations/" + file, "utf8")
          .replace(/\r\n/g, "\n")
          .trimEnd() + "\n",
      )
      .digest("hex");
    if (!checks.migrations.some((x) => x.file === file && x.sha256 === sha))
      throw Error("Migration changed after tests");
  }
  if (!migrationBefore.includes("0006_console_registry.sql"))
    throw Error("Expected S3-A baseline required");
  if (pending.length) {
    console.log(
      JSON.stringify({
        operation: "reviewed-additive-preview-migrations",
        account,
        target: "campusos-preview",
        databaseId: id,
        pending,
      }),
    );
    const result = spawnSync(
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
      { env: process.env, stdio: "inherit" },
    );
    if (result.status !== 0)
      throw Error(
        "Migration failed; preserve database and inspect, never rebuild",
      );
    applied = true;
  }
}
const after = await counts(),
  afterSources = JSON.stringify(await sources()),
  migrationAfter = (
    await sql("SELECT name FROM d1_migrations ORDER BY id")
  ).map((x) => x.name),
  fk = await sql("PRAGMA foreign_key_check");
const report = {
  recordedAt: new Date().toISOString(),
  target: "campusos-preview",
  accountMatched: true,
  createdResources: false,
  applied,
  pendingBefore: pending,
  migrationBefore,
  migrationAfter,
  before,
  after,
  sourceHumanStatesPreserved: beforeSources === afterSources,
  allCountsPreserved: JSON.stringify(before) === JSON.stringify(after),
  foreignKeyViolations: fk.length,
  noSourceReimport: true,
  noDestructiveRebuild: true,
};
if (
  !report.sourceHumanStatesPreserved ||
  !report.allCountsPreserved ||
  fk.length
)
  throw Error("Post-migration invariant changed; no rollback/delete attempted");
mkdirSync("docs/verification/s3-b", { recursive: true });
writeFileSync(
  "docs/verification/s3-b/" +
    (applied ? "preview-migration.json" : "preview-readonly.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
