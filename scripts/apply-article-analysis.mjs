// Controlled Preview-only derived projection update. Source documents are never updated.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";
const config = parse(readFileSync("wrangler.jsonc", "utf8")),
  account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(config, account);
if (!process.argv.includes("--apply"))
  throw Error("Use --apply after offline evaluation");
const limit = Number(
  process.argv.find((x) => x.startsWith("--limit="))?.split("=")[1] || "10000",
);
const dir = "test-results/article-analysis";
mkdirSync(dir, { recursive: true });
const bundle = path.resolve(dir + "/writer.mjs");
await build({
  stdin: {
    contents:
      'export {analysisStatements} from "./src/lib/server/console/article-analysis";export {ARTICLE_CLASSIFIER_VERSION} from "./src/domain/console/article-analysis";',
    resolveDir: process.cwd(),
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { analysisStatements, ARTICLE_CLASSIFIER_VERSION } = await import(
  pathToFileURL(bundle).href + "?t=" + Date.now()
);
const corpus = JSON.parse(readFileSync(dir + "/corpus.json", "utf8")).documents;
const predictions = new Map(
  JSON.parse(readFileSync(dir + "/predictions.json", "utf8")).map((p) => [
    p.id,
    p.analysis,
  ]),
);
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(auth.slice(auth.indexOf("{")));
const dbId = config.env.preview.d1_databases[0].database_id;
const usage = { rowsRead: 0, rowsWritten: 0, queries: 0 },
  report = {
    startedAt: new Date().toISOString(),
    target: "campusos-preview",
    classifierVersion: ARTICLE_CLASSIFIER_VERSION,
    applied: [],
    unchanged: [],
    stale: [],
    usage,
  };
async function request(body) {
  const results = await previewCloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`,
    token,
    body,
  );
  for (const r of results) {
    usage.rowsRead += r.meta.rows_read;
    usage.rowsWritten += r.meta.rows_written;
    usage.queries++;
  }
  return results;
}
const adapter = {
  prepare(sql) {
    return {
      sql,
      params: [],
      bind(...params) {
        this.params = params;
        return this;
      },
    };
  },
};
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
for (let i = 0; i < Math.min(limit, corpus.length) && !stopping; i += 4) {
  const chunk = corpus.slice(i, Math.min(i + 4, limit));
  const [result] = await request({
    sql: `SELECT d.id,d.input_hash,d.content_revision,d.content_hash,d.publication_status,d.lifecycle_status,d.version,a.input_hash AS analysis_hash,a.content_revision AS analysis_revision,a.classifier_version FROM knowledge_documents d LEFT JOIN document_article_analysis a ON a.document_id=d.id WHERE d.id IN(${chunk.map(() => "?").join(",")}) AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'`,
    params: chunk.map((d) => d.id),
  });
  const statements = [],
    ids = [];
  for (const d of chunk) {
    const live = result.results.find((r) => r.id === d.id);
    if (
      !live ||
      live.input_hash !== d.input_hash ||
      live.content_revision !== d.content_revision
    ) {
      report.stale.push(d.id);
      continue;
    }
    if (
      live.analysis_hash === live.input_hash &&
      live.analysis_revision === live.content_revision &&
      live.classifier_version === ARTICLE_CLASSIFIER_VERSION
    ) {
      report.unchanged.push(d.id);
      continue;
    }
    const analysis = predictions.get(d.id);
    if (!analysis) throw Error("Missing evaluated prediction");
    statements.push(
      ...(await analysisStatements(
        adapter,
        d.id,
        d.content_revision,
        d.input_hash,
        {
          title: d.title,
          body: d.body,
          bodyFormat: "plain",
          bodyStatus: d.body_status,
          publishedAt: d.published_at,
          originalUrl: d.url,
        },
        analysis,
      )),
    );
    ids.push({ id: d.id, before: live });
  }
  if (statements.length) {
    await request({
      batch: statements.map((s) => ({ sql: s.sql, params: s.params })),
    });
    report.applied.push(...ids);
  }
  writeFileSync(
    dir + "/application.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  if (i % 100 === 0)
    console.log(
      JSON.stringify({
        processed: i + chunk.length,
        applied: report.applied.length,
        unchanged: report.unchanged.length,
        stale: report.stale.length,
        usage,
      }),
    );
}
report.completedAt = new Date().toISOString();
writeFileSync(
  dir + "/application.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    applied: report.applied.length,
    unchanged: report.unchanged.length,
    stale: report.stale.length,
    usage,
  }),
);
