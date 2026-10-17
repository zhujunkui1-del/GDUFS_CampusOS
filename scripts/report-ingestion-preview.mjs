// Public operational metadata only; no student messages, positions or credentials.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";
const config = parse(readFileSync("wrangler.jsonc", "utf8")),
  account = process.env.CLOUDFLARE_ACCOUNT_ID;
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
const database = await call("/d1/database/" + id);
if (database.name !== "campusos-preview" || database.uuid !== id)
  throw Error("Preview database identity mismatch");
const query = async (sql) => {
  if (!/^(SELECT|PRAGMA foreign_key_check)/.test(sql))
    throw Error("Read only query required");
  const [result] = await call(`/d1/database/${id}/query`, { sql, params: [] });
  return {
    rows: result.results,
    rowsRead: result.meta?.rows_read ?? null,
    rowsWritten: result.meta?.rows_written ?? null,
    sqlDurationMs:
      result.meta?.timings?.sql_duration_ms ?? result.meta?.duration ?? null,
  };
};
const unselected = await query(
  "SELECT id,version,enabled,verification_status,official_status,permission_status,authorization_status FROM knowledge_sources WHERE id NOT IN('GDUFS-SRC-0010','GDUFS-SRC-0017','GDUFS-SRC-0008') ORDER BY id",
);
const fingerprint = createHash("sha256")
  .update(JSON.stringify(unselected.rows))
  .digest("hex");
const count = await query(
  "SELECT (SELECT count(*) FROM knowledge_sources) AS sources,(SELECT count(*) FROM knowledge_sources WHERE enabled=1) AS enabled,(SELECT count(*) FROM knowledge_sources WHERE verification_status='verified') AS verified,(SELECT count(*) FROM knowledge_sources WHERE verification_status='candidate') AS candidates,(SELECT count(*) FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private') AS documents,(SELECT count(*) FROM knowledge_documents WHERE rights_scope='metadata_only' AND body='仅登记公开元数据，未保存第三方正文。') AS metadataOnlyBodies,(SELECT count(*) FROM console_public_documents) AS published,(SELECT count(*) FROM console_content_reviews) AS reviews,(SELECT count(*) FROM campus_events) AS events,(SELECT count(*) FROM knowledge_chunks) AS chunks,(SELECT count(*) FROM ingestion_jobs) AS jobs,(SELECT sum(duplicate_count) FROM ingestion_jobs) AS duplicates,(SELECT sum(error_count) FROM ingestion_jobs) AS errors,(SELECT sum(request_count) FROM ingestion_jobs) AS reservedRequests,(SELECT count(*) FROM conversations) AS conversations,(SELECT count(*) FROM conversation_messages) AS messages,(SELECT count(*) FROM agent_runs) AS agentRuns",
);
const base = {
  recordedAt: new Date().toISOString(),
  realCloud: true,
  target: "campusos-preview",
  unselectedSources: unselected.rows.length,
  unselectedSourceStateSha256: fingerprint,
  counts: count.rows[0],
  auditQueryMeta: {
    rowsRead: count.rowsRead,
    rowsWritten: count.rowsWritten,
    sqlDurationMs: count.sqlDurationMs,
  },
};
mkdirSync("docs/verification/s3-b", { recursive: true });
if (process.argv.includes("--before")) {
  writeFileSync(
    "docs/verification/s3-b/preview-before-collection.json",
    JSON.stringify(base, null, 2) + "\n",
  );
  console.log(JSON.stringify(base));
} else {
  const before = JSON.parse(
    readFileSync(
      "docs/verification/s3-b/preview-before-collection.json",
      "utf8",
    ),
  );
  const documents = await query(
    "SELECT id,source_id,title,url,published_at,fetched_at,source_updated_at,updated_at,version,content_revision,rights_scope,review_status,publication_status,radar_category,knowledge_category FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private' ORDER BY source_id LIMIT 10",
  );
  const jobs = await query(
    "SELECT id,source_id,status,phase,control_state,found_count,body_count,duplicate_count,error_count,request_count FROM ingestion_jobs ORDER BY created_at LIMIT 10",
  );
  const deployments = await call(
    "/workers/scripts/campusos-preview/deployments",
  );
  const guard = await query(
    "SELECT sql FROM sqlite_master WHERE name='ingestion_command_guard'",
  );
  const normalizeSql = (value) =>
    value.replace(/\r\n/g, "\n").trim().replace(/;$/, "");
  const expectedGuard = readFileSync(
    "migrations/0011_ingestion_daily_budget.sql",
    "utf8",
  ).split("CREATE TRIGGER ingestion_command_guard")[1];
  const deployedGuardMatchesSource =
    normalizeSql(String(guard.rows[0]?.sql || "")) ===
    normalizeSql("CREATE TRIGGER ingestion_command_guard" + expectedGuard);
  const report = {
    ...base,
    unselectedSourceStatesPreserved:
      fingerprint === before.unselectedSourceStateSha256,
    studentCountsPreserved: ["conversations", "messages", "agentRuns"].every(
      (k) => base.counts[k] === before.counts[k],
    ),
    dailyBudgetUsesReservationTime: String(guard.rows[0]?.sql || "").includes(
      "count(*)*2 FROM console_commands",
    ),
    deployedGuardMatchesSource,
    documents: documents.rows,
    jobs: jobs.rows,
    workerVersion: deployments.deployments?.[0]?.versions,
    foreignKeyViolations: (await query("PRAGMA foreign_key_check")).rows.length,
    modelGenerationCallsByThisTask: 0,
    indicesOrDifyConfiguredByThisTask: false,
  };
  if (
    !report.unselectedSourceStatesPreserved ||
    !report.studentCountsPreserved ||
    report.foreignKeyViolations
  )
    throw Error("Preview invariant changed; inspect without deleting data");
  writeFileSync(
    "docs/verification/s3-b/preview-after.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
