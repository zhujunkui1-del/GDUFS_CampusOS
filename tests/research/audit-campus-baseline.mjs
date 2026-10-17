// Research only: fixed preview target, public operations aggregates, no mutations.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "comment-json";
import { assertPreviewTarget } from "../../scripts/preview-config.mjs";
import { previewCloudflareJson } from "../../scripts/preview-network.mjs";

if (process.argv.slice(2).join(" ") !== "--remote-preview")
  throw Error("Explicit --remote-preview required; read-only audit only");
const config = parse(readFileSync("wrangler.jsonc", "utf8"));
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(config, account);
const id = config.env.preview.d1_databases[0].database_id;
const output = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(output.slice(output.indexOf("{")));
const call = (path, body) =>
  previewCloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
    token,
    body,
  );
const database = await call(`/d1/database/${id}`);
if (database.name !== "campusos-preview" || database.uuid !== id)
  throw Error("Preview database identity mismatch");
async function query(sql) {
  if (!/^(SELECT |PRAGMA foreign_key_check$)/.test(sql))
    throw Error("Read-only SQL required");
  const [result] = await call(`/d1/database/${id}/query`, { sql, params: [] });
  return result.results;
}
const counts = await query(
  "SELECT (SELECT count(*) FROM knowledge_sources) AS sources,(SELECT count(*) FROM knowledge_sources WHERE enabled=1) AS enabled,(SELECT count(*) FROM knowledge_sources WHERE verification_status='verified') AS verified,(SELECT count(*) FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private') AS documents,(SELECT count(*) FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private' AND review_status='pending') AS pending,(SELECT count(*) FROM console_public_documents) AS published,(SELECT count(*) FROM ingestion_jobs) AS jobs,(SELECT sum(duplicate_count) FROM ingestion_jobs) AS duplicates,(SELECT sum(error_count) FROM ingestion_jobs) AS errors",
);
const tables = await query(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name",
);
const migrations = await query("SELECT name FROM d1_migrations ORDER BY name");
const policies = await query(
  "SELECT source_id,rights_scope,expires_at_ms FROM source_collection_policies ORDER BY source_id",
);
const foreignKeyViolations = (await query("PRAGMA foreign_key_check")).length;
const deployments = await call("/workers/scripts/campusos-preview/deployments");
const report = {
  recordedAt: new Date().toISOString(),
  realCloud: true,
  readOnly: true,
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  target: "campusos-preview",
  counts: counts[0],
  businessTables: tables.length,
  tables: tables.map((x) => x.name),
  migrations: migrations.map((x) => x.name),
  policies,
  foreignKeyViolations,
  workerVersions: deployments.deployments?.[0]?.versions ?? [],
  studentPrivateDataRead: false,
  modelCalls: 0,
  deploymentOrMigration: false,
};
mkdirSync("docs/verification/s3-wechat", { recursive: true });
writeFileSync(
  "docs/verification/s3-wechat/campus-baseline.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    counts: report.counts,
    businessTables: report.businessTables,
    foreignKeyViolations,
    workerVersions: report.workerVersions,
  }),
);
