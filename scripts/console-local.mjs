// Dedicated local workerd/D1 and development credentials; never a cloud deploy.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { build } from "esbuild";
const dir = ".map-tools/s3-a";
mkdirSync(dir, { recursive: true });
mkdirSync("test-results", { recursive: true });
const secretFile = dir + "/local-secrets.json";
if (!existsSync(secretFile))
  writeFileSync(
    secretFile,
    JSON.stringify(
      {
        CONSOLE_AUTH_MODE: "local_key",
        CONSOLE_ADMIN_EMAILS: "operator@s3-test.invalid",
        CONSOLE_SESSION_SECRET: randomBytes(48).toString("base64url"),
        CONSOLE_LOCAL_ACCESS_KEY: randomBytes(32).toString("hex"),
        AGENT_SIGNING_SECRET: randomBytes(48).toString("base64url"),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
const secrets = JSON.parse(readFileSync(secretFile, "utf8"));
writeFileSync(
  dir + "/.dev.vars",
  Object.entries(secrets)
    .map(([key, value]) => key + "=" + JSON.stringify(value))
    .join("\n") + "\n",
  { mode: 0o600 },
);
const config = dir + "/wrangler.local.json";
writeFileSync(
  config,
  JSON.stringify(
    {
      name: "campusos-console-local",
      main: "../../.open-next/worker.js",
      compatibility_date: "2026-10-12",
      compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
      assets: { directory: "../../.open-next/assets", binding: "ASSETS" },
      vars: { APP_ENV: "local" },
      services: [
        { binding: "WORKER_SELF_REFERENCE", service: "campusos-console-local" },
      ],
      d1_databases: [
        {
          binding: "DB",
          database_name: "campusos-console-local",
          database_id: "00000000-0000-0000-0000-000000000006",
          migrations_dir: "../../migrations",
        },
      ],
    },
    null,
    2,
  ) + "\n",
);
if (process.argv.includes("--prepare")) {
  await build({
    entryPoints: ["src/lib/server/console/catalog.ts"],
    outfile: "test-results/console-local-catalog.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    tsconfig: "tsconfig.json",
    logLevel: "silent",
  });
  const require = createRequire(import.meta.url),
    { importCatalog } = require(
      resolve("test-results/console-local-catalog.cjs"),
    );
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync("migrations/" + file, "utf8"));
  const writes = [];
  const db = {
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
          writes.push({ sql, values });
          return {
            meta: {
              changes: Number(sqlite.prepare(sql).run(...values).changes),
            },
          };
        },
      };
    },
  };
  await importCatalog(
    db,
    JSON.parse(
      readFileSync("data/console/source-catalog-2026-10-17.json", "utf8"),
    ),
    "Local isolated catalog CLI",
  );
  sqlite.close();
  const literal = (value) =>
    typeof value === "number"
      ? String(value)
      : value === null
        ? "NULL"
        : "'" + String(value).replace(/'/g, "''") + "'";
  const statements = [];
  for (const entry of writes) {
    const params = entry.values;
    const groups = entry.sql.startsWith("INSERT INTO knowledge_sources")
      ? JSON.parse(params[1]).map((row) => [params[0], JSON.stringify([row])])
      : [params];
    for (const group of groups) {
      let index = 0;
      statements.push(
        entry.sql.replace(/\?/g, () => literal(group[index++])) + ";",
      );
    }
  }
  writeFileSync(
    "test-results/console-local-catalog.sql",
    statements.join("\n") + "\n",
  );
  console.log(
    JSON.stringify({
      prepared: true,
      localOnly: true,
      config,
      credentialFile: secretFile,
      valuesPrinted: false,
      seedStatements: statements.length,
    }),
  );
} else {
  const child = spawn(
    process.execPath,
    [
      "node_modules/@opennextjs/cloudflare/dist/cli/index.js",
      "preview",
      "--config",
      config,
      "--persist-to",
      dir + "/worker-state",
      "--port",
      "8787",
      "--log-level",
      "error",
    ],
    { stdio: "inherit", env: process.env },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill());
  child.on("exit", (code) => (process.exitCode = code || 0));
}
