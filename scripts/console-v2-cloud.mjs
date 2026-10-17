// Existing preview maintenance only. No content publication or cleanup actions.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";
const cfg = parse(readFileSync("wrangler.jsonc", "utf8")),
  account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(cfg, account);
const id = cfg.env.preview.d1_databases[0].database_id;
const label =
  process.argv.find((v) => v.startsWith("--label="))?.slice(8) ||
  "snapshot-" + Date.now();
if (!/^[\w-]+$/.test(label)) throw Error("Invalid evidence label");
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
  throw Error("Preview identity mismatch");
const queries = [];
async function query(sql, params = []) {
  if (!/^(SELECT |PRAGMA foreign_key_check$)/.test(sql))
    throw Error("Read-only SQL required");
  const started = performance.now();
  const [r] = await call(`/d1/database/${id}/query`, { sql, params });
  queries.push({
    ordinal: queries.length + 1,
    durationMs: r.meta?.duration ?? null,
    wallMs: Math.round(performance.now() - started),
    rowsRead: r.meta?.rows_read ?? null,
    rowsWritten: r.meta?.rows_written ?? null,
  });
  return r.results;
}
const counts = async () =>
  (
    await query(
      "SELECT (SELECT count(*) FROM knowledge_sources) sources,(SELECT count(*) FROM knowledge_sources WHERE enabled=1) enabled,(SELECT count(*) FROM knowledge_sources WHERE verification_status='verified') verified,(SELECT count(*) FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private') documents,(SELECT count(*) FROM console_public_documents) published,(SELECT count(*) FROM ingestion_jobs) jobs,(SELECT count(*) FROM conversations) conversations,(SELECT count(*) FROM conversation_messages) messages,(SELECT count(*) FROM agent_runs) runs",
    )
  ).at(0);
const fingerprint = async () =>
  createHash("sha256")
    .update(
      JSON.stringify(
        await query(
          "SELECT id,enabled,verification_status,permission_status,authorization_status,official_status,version FROM knowledge_sources ORDER BY id",
        ),
      ),
    )
    .digest("hex");
const migrations = async () =>
  (await query("SELECT name FROM d1_migrations ORDER BY id")).map(
    (r) => r.name,
  );
const before = {
  at: new Date().toISOString(),
  counts: await counts(),
  migrations: await migrations(),
  sourceHash: await fingerprint(),
};
const pending = readdirSync("migrations").filter(
  (f) => f.endsWith(".sql") && !before.migrations.includes(f),
);
if (process.argv.includes("--migrate") && pending.length) {
  const evidence = JSON.parse(
    readFileSync("docs/verification/console-v2/database-upgrade.json", "utf8"),
  );
  if (
    !evidence.emptyMigration ||
    !evidence.populatedUpgrade ||
    !evidence.failedMigrationRollback ||
    !evidence.oldRowsAndPrivateDataUnchanged
  )
    throw Error("Local upgrade evidence required");
  for (const file of pending) {
    const sql =
      readFileSync("migrations/" + file, "utf8")
        .replace(/\r\n/g, "\n")
        .trimEnd() + "\n";
    if (
      /\b(DROP\s+TABLE|DELETE\s+FROM|ALTER\s+TABLE\s+\w+\s+RENAME)\b/i.test(
        sql,
      ) ||
      !evidence.migrations.some(
        (m) =>
          m.file === file &&
          m.sha256 === createHash("sha256").update(sql).digest("hex"),
      )
    )
      throw Error("Unreviewed/dangerous migration; no remote changes");
  }
  console.log(
    JSON.stringify({ target: "campusos-preview", databaseId: id, pending }),
  );
  const r = spawnSync(
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
  if (r.status !== 0) throw Error("Migration incomplete, DB retained");
}
const after = await counts(),
  names = await migrations(),
  foreignKeys = await query("PRAGMA foreign_key_check");
const size = Number.isSafeInteger(database.file_size)
  ? database.file_size
  : null;
if (process.argv.includes("--record-storage")) {
  if (size === null || !names.includes("0014_console_v2_governance.sql"))
    throw Error("Real metadata/table required");
  const at = new Date().toISOString();
  await call(`/d1/database/${id}/query`, {
    sql: "INSERT INTO console_storage_samples(id,measured_at,provider,bytes) VALUES(?,?,'cloudflare_api',?)",
    params: ["cf-" + Date.now(), at, size],
  });
}
const report = {
  recordedAt: new Date().toISOString(),
  realCloud: true,
  target: "campusos-preview",
  before,
  after,
  migrations: names,
  sourceStateUnchanged: before.sourceHash === (await fingerprint()),
  foreignKeyViolations: foreignKeys.length,
  storage: {
    provider: "cloudflare_api",
    bytes: size,
    measuredAt: before.at,
    estimated: false,
  },
  workerVersions: (await call("/workers/scripts/campusos-preview/deployments"))
    .deployments?.[0]?.versions,
  documents: await query(
    "SELECT id,source_id,title,published_at,review_status,publication_status,lifecycle_status,version FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private' ORDER BY id LIMIT 20",
  ),
  queries,
  migrationApplied: process.argv.includes("--migrate") && pending.length > 0,
  permanentDataCleanupExecuted: false,
  contentPublishedByThisRun: false,
};
mkdirSync("docs/verification/console-v2/cloud", { recursive: true });
writeFileSync(
  `docs/verification/console-v2/cloud/${label}.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    target: report.target,
    counts: after,
    storageBytes: size,
    foreignKeyViolations: foreignKeys.length,
    migrationApplied: report.migrationApplied,
  }),
);
if (foreignKeys.length) process.exitCode = 1;
