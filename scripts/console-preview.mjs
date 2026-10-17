// Read-only deployment/D1 audit except explicit --migrate-compatible, which
// applies only the reviewed additive 0006 migration to the exact preview target.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
const account = process.env.CLOUDFLARE_ACCOUNT_ID,
  config = parse(readFileSync("wrangler.jsonc", "utf8"));
assertPreviewTarget(config, account);
const databaseId = config.env.preview.d1_databases[0].database_id;
function cli(...args) {
  try {
    return JSON.parse(
      execFileSync(
        process.execPath,
        ["node_modules/wrangler/bin/wrangler.js", ...args, "--json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
  } catch {
    throw Error("Cloudflare authentication unavailable; raw output withheld");
  }
}
const who = cli("whoami");
if (!who.loggedIn || !who.accounts?.some((a) => a.id === account))
  throw Error("Preview account mismatch");
const { token } = cli("auth", "token");
async function call(path, body) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    },
  );
  const j = await r.json();
  if (!r.ok || !j.success)
    throw Error(
      `Read-only Cloudflare audit failed (HTTP${r.status}); raw output withheld`,
    );
  return j.result;
}
const database = await call(`/d1/database/${databaseId}`);
if (database.uuid !== databaseId || database.name !== "campusos-preview")
  throw Error("Preview database identity mismatch");
async function sql(query, params = []) {
  return (
    await call(`/d1/database/${databaseId}/query`, { sql: query, params })
  )[0].results;
}
const dir = "docs/verification/s3-a";
mkdirSync(dir, { recursive: true });
const counts = async () =>
  (
    await sql(
      "SELECT (SELECT count(*) FROM conversations) AS conversations,(SELECT count(*) FROM conversation_messages) AS messages,(SELECT count(*) FROM agent_runs) AS runs,(SELECT count(*) FROM knowledge_sources) AS sources,(SELECT count(*) FROM knowledge_documents) AS documents",
    )
  )[0];
const before = await counts();
let migrations = await sql("SELECT name FROM d1_migrations ORDER BY id");
if (process.argv.includes("--migrate-compatible")) {
  const ddl = readFileSync("migrations/0006_console_registry.sql", "utf8");
  if (/^\s*(DROP|DELETE|TRUNCATE|REPLACE)\s/im.test(ddl))
    throw Error("Destructive migration refused");
  if (migrations.some((m) => m.name === "0006_console_registry.sql"))
    throw Error("0006 already applied; do not rerun mutation path");
  if (!migrations.some((m) => m.name === "0005_assistant_conversations.sql"))
    throw Error("Expected 0005 preview baseline required");
  const local = JSON.parse(readFileSync(`${dir}/database-tests.json`, "utf8"));
  if (!local.emptyMigrationPassed || !local.populatedUpgradePassed)
    throw Error("Passing local empty/populated migration evidence is required");
  console.log(
    JSON.stringify({
      operation: "compatible-preview-migration",
      target: "campusos-preview",
      databaseId,
      account,
      onlyPendingMigration: "0006_console_registry.sql",
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
      "Preview migration failed; database preserved, no rebuild attempted",
    );
  migrations = await sql("SELECT name FROM d1_migrations ORDER BY id");
  const after = await counts();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw Error(
      "Content counts changed during migration; inspect rather than clearing data",
    );
  writeFileSync(
    `${dir}/preview-migration.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        database: "campusos-preview",
        databaseId,
        migrations: migrations.map((m) => m.name),
        before,
        after,
        contentCountsPreserved: true,
        foreignKeyViolations: (await sql("PRAGMA foreign_key_check")).length,
      },
      null,
      2,
    ) + "\n",
  );
} else {
  const settings = await call("/workers/scripts/campusos-preview/settings"),
    deployments = await call("/workers/scripts/campusos-preview/deployments");
  const ready = migrations.some((m) => m.name === "0006_console_registry.sql");
  const registry = ready
    ? (
        await sql(
          "SELECT count(*) AS sources,sum(enabled) AS enabled,sum(verification_status='candidate') AS candidates,sum(verification_status='verified') AS verified FROM knowledge_sources WHERE console_managed=1",
        )
      )[0]
    : null;
  const result = {
    at: new Date().toISOString(),
    readOnly: true,
    accountMatched: true,
    worker: "campusos-preview",
    database: "campusos-preview",
    databaseId,
    migrations: migrations.map((m) => m.name),
    counts: before,
    registry,
    foreignKeyViolations: (await sql("PRAGMA foreign_key_check")).length,
    activeVersions: deployments.deployments?.[0]?.versions,
    deploymentId: deployments.deployments?.[0]?.id,
    consoleState: ready
      ? (
          await sql(
            "SELECT (SELECT count(*) FROM console_admins) AS admins,(SELECT count(*) FROM console_sessions) AS sessions,(SELECT count(*) FROM console_sessions WHERE revoked_at_ms IS NULL AND expires_at_ms>unixepoch('now')*1000) AS activeSessions,(SELECT count(*) FROM console_commands) AS commands,(SELECT count(*) FROM console_public_documents) AS publicDocuments,(SELECT count(*) FROM console_audit_logs WHERE action='auth.login') AS logins,(SELECT count(*) FROM console_audit_logs WHERE action='auth.logout') AS logouts",
          )
        )[0]
      : null,
    bindings: settings.bindings?.map(({ name, type }) => ({ name, type })),
    dnsOrRoutesModifiedByThisTool: false,
  };
  writeFileSync(
    `${dir}/preview-${ready ? "after" : "before"}.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      readOnly: true,
      target: result.database,
      migrationCount: migrations.length,
      counts: before,
      registry,
      activeVersions: result.activeVersions,
    }),
  );
}
