import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";
const config = parse(readFileSync("wrangler.jsonc", "utf8")),
  account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(config, account);
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(auth.slice(auth.indexOf("{")));
const dbId = config.env.preview.d1_databases[0].database_id;
const dir = "docs/verification/article-analysis-2026-10-25";
mkdirSync(dir, { recursive: true });
const bundle = path.resolve("test-results/article-analysis/measurer.mjs");
await build({
  stdin: {
    contents:
      'export {readPublicContent} from "./src/lib/server/console/public-content";export {readPublicAnalysis,readPublicActivities} from "./src/lib/server/console/public-analysis";',
    resolveDir: process.cwd(),
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const api = await import(pathToFileURL(bundle).href);
let active;
const records = [];
const db = {
  prepare(sql) {
    let params = [];
    const statement = {
      bind(...v) {
        params = v;
        return statement;
      },
      async all() {
        if (!/^\s*(?:SELECT|WITH)\b/.test(sql)) throw Error("Read only");
        const [r] = await previewCloudflareJson(
          `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`,
          token,
          { sql, params },
        );
        active.rowsRead += r.meta.rows_read;
        active.rowsWritten += r.meta.rows_written;
        active.sqlDurationMs += r.meta.duration;
        active.queries.push({
          sql,
          rowsRead: r.meta.rows_read,
          rowsWritten: r.meta.rows_written,
          durationMs: r.meta.duration,
        });
        return { results: r.results };
      },
      async first() {
        return (await statement.all()).results[0] || null;
      },
    };
    return statement;
  },
};
const example = "wx-478e4479fc6e30cf7588b8d8f8b9815d4c08c84d";
for (const [name, call] of [
  [
    "radar-cold",
    () =>
      api.readPublicContent(db, { surface: "radar", grouped: "1", limit: 12 }),
  ],
  [
    "radar-warm",
    () =>
      api.readPublicContent(db, { surface: "radar", grouped: "1", limit: 12 }),
  ],
  [
    "knowledge-cold",
    () =>
      api.readPublicContent(db, {
        surface: "knowledge",
        grouped: "1",
        limit: 12,
      }),
  ],
  ["analysis-one", () => api.readPublicAnalysis(db, example)],
  [
    "competition-window",
    () =>
      api.readPublicActivities(db, {
        category: "competition",
        after: "2026-10-25",
        before: "2026-11-30",
        limit: 10,
      }),
  ],
]) {
  active = { name, rowsRead: 0, rowsWritten: 0, sqlDurationMs: 0, queries: [] };
  const start = performance.now(),
    result = await call();
  active.clientWallMs = Math.round(performance.now() - start);
  active.returned = result.items?.length ?? 1;
  active.total = result.total ?? null;
  records.push(active);
  console.log(JSON.stringify({ ...active, queries: active.queries.length }));
}
writeFileSync(
  dir + "/query-cost.json",
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      scope:
        "Actual Preview D1, exact runtime query functions; REST orchestration client wall time is not Worker CPU",
      records,
    },
    null,
    2,
  ) + "\n",
);
