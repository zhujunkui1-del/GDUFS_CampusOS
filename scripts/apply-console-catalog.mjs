// Explicit operator-only application. Remote target is always campusos-preview.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
const remote = process.argv.includes("--remote-preview"),
  local = process.argv.includes("--local");
if (remote === local)
  throw Error(
    "Choose exactly --local or --remote-preview; no default remote target",
  );
const dir = "docs/verification/s3-a/import";
mkdirSync(dir, { recursive: true });
mkdirSync(".map-tools/s3-a", { recursive: true });
mkdirSync("test-results", { recursive: true });
const manifest = JSON.parse(
  readFileSync("data/console/source-catalog-2026-10-17.json", "utf8"),
);
const report = JSON.parse(readFileSync(`${dir}/dry-run.json`, "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (
  !report.passed ||
  report.errors.length ||
  hash(JSON.stringify(manifest)) !== report.manifestHash
)
  throw Error("Matching successful dry-run required");
for (const file of manifest.files) {
  if (
    ![
      "CampusOS_Codex_完整设计文档_v2/CampusOS_广外信息源_去重详表_2026-10-17.xlsx",
      "CampusOS_Codex_完整设计文档_v2/CampusOS_广外信息源_去重详表_2026-10-17.md",
    ].includes(file.file) ||
    hash(readFileSync(file.file)) !== file.sha256
  )
    throw Error("Original read-only catalog hash changed");
}
await build({
  entryPoints: ["src/lib/server/console/catalog.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "test-results/console-catalog-import.cjs",
  logLevel: "silent",
  tsconfig: "tsconfig.json",
});
const require = createRequire(import.meta.url),
  { importCatalog } = require(
    resolve("test-results/console-catalog-import.cjs"),
  );
let db, sqlite, actor;
if (local) {
  const path = resolve(".map-tools/s3-a/catalog-local.sqlite");
  sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys=ON");
  if (
    !sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE name='console_admins'")
      .get()
  ) {
    if (sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='users'").get())
      throw Error(
        "Existing unversioned local database; refusing implicit migration",
      );
    for (const file of readdirSync("migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      sqlite.exec(readFileSync("migrations/" + file, "utf8"));
  }
  db = {
    prepare(sql) {
      let values = [];
      return {
        bind(...params) {
          values = params;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) || null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...values) };
        },
        async run() {
          return {
            meta: {
              changes: Number(sqlite.prepare(sql).run(...values).changes),
            },
          };
        },
      };
    },
  };
  actor = "Local authorized catalog CLI";
} else {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID,
    config = parse(readFileSync("wrangler.jsonc", "utf8"));
  assertPreviewTarget(config, account);
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
    throw Error("Explicit preview account mismatch");
  const { token } = cli("auth", "token"),
    id = config.env.preview.d1_databases[0].database_id;
  async function call(path, body) {
    const response = await fetch(
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
    const value = await response.json();
    if (!response.ok || !value.success)
      throw Error(
        `Preview D1 operation failed (${response.status}); raw SQL/errors withheld`,
      );
    return value.result;
  }
  const database = await call(`/d1/database/${id}`);
  if (database.name !== "campusos-preview" || database.uuid !== id)
    throw Error("Wrong preview database; no import performed");
  const migration = await call(`/d1/database/${id}/query`, {
    sql: "SELECT name FROM d1_migrations WHERE name='0006_console_registry.sql'",
    params: [],
  });
  if (migration[0].results.length !== 1)
    throw Error("Preview 0006 migration is required before import");
  db = {
    prepare(sql) {
      let params = [];
      const execute = async () =>
        (await call(`/d1/database/${id}/query`, { sql, params }))[0];
      return {
        bind(...values) {
          params = values;
          return this;
        },
        async first() {
          return (await execute()).results[0] || null;
        },
        async all() {
          return { results: (await execute()).results };
        },
        async run() {
          return { meta: { changes: (await execute()).meta?.changes || 0 } };
        },
      };
    },
  };
  actor = "Cloudflare authorized catalog CLI";
  console.log(
    JSON.stringify({
      target: "campusos-preview",
      databaseId: id,
      accountMatched: true,
      dryRunPassed: true,
      records: manifest.records.length,
    }),
  );
}
try {
  const first = await importCatalog(db, manifest, actor),
    second = await importCatalog(db, manifest, actor);
  if (second.inserted !== 0 || second.imported !== first.imported)
    throw Error("Catalog idempotency check failed");
  const audit = await db
    .prepare(
      "SELECT count(*) AS n FROM console_audit_logs WHERE action='source.import'",
    )
    .first();
  const result = {
    recordedAt: new Date().toISOString(),
    realCloud: remote,
    target: remote ? "campusos-preview" : "isolated-local-sqlite",
    first,
    second,
    sourceImportAuditRows: audit.n,
    originalFilesUnchanged: true,
    modelCalls: 0,
  };
  writeFileSync(
    `${dir}/${remote ? "preview" : "local"}-import.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      realCloud: remote,
      imported: first.imported,
      inserted: first.inserted,
      enabled: first.enabled,
      candidates: first.candidates,
      verified: first.verified,
      failed: first.failed,
      repeatInserted: second.inserted,
      auditRows: audit.n,
    }),
  );
} finally {
  sqlite?.close();
}
