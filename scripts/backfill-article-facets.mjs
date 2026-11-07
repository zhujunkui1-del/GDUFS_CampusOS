// One-off derived-facet backfill: fills college / event_type / event_start /
// event_end on existing document_article_analysis rows. Classification,
// calendar state and publication are untouched. The facets come from the same
// analyzer the pipeline uses, so backfill and new ingestion cannot disagree.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { parse } from "comment-json";
import { previewCloudflareJson } from "./preview-network.mjs";

const config = parse(readFileSync("wrangler.jsonc", "utf8")),
  account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) throw Error("Need CLOUDFLARE_ACCOUNT_ID");
const dbId = config.env.preview.d1_databases[0].database_id;
const dir = "test-results/article-analysis";
const bundle = path.resolve(dir + "/facets.mjs");
await build({
  stdin: {
    contents:
      'export {analyzeArticle} from "./src/lib/ingestion/article-analysis";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { analyzeArticle } = await import(
  pathToFileURL(bundle).href + "?t=" + Date.now()
);
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(auth.slice(auth.indexOf("{")));
const corpus = JSON.parse(readFileSync(dir + "/corpus.json", "utf8")).documents;
const usage = { rowsRead: 0, rowsWritten: 0, queries: 0 };
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
const apply = process.argv.includes("--apply");
let prepared = 0,
  withCollege = 0;
for (let i = 0; i < corpus.length; i += 20) {
  const chunk = corpus.slice(i, i + 20);
  const statements = chunk.map((d) => {
    const a = analyzeArticle({
      documentId: d.id,
      title: d.title,
      body: d.body,
      bodyFormat: d.body_format,
      bodyStatus: d.body_status,
      sourceId: d.source_id,
      sourceName: d.display_name,
      originalUrl: d.url,
      publishedAt: d.published_at,
      contentType: d.content_type,
    });
    if (a.college) withCollege++;
    return {
      sql: `UPDATE document_article_analysis SET college=?,event_type=?,event_start=?,event_end=? WHERE document_id=? AND content_revision=? AND input_hash=?`,
      params: [
        a.college || "",
        a.eventType || "",
        a.eventStart || null,
        a.eventEnd || null,
        d.id,
        d.content_revision,
        d.input_hash,
      ],
    };
  });
  prepared += statements.length;
  if (apply) await request({ batch: statements });
  if (i % 400 === 0) console.log(JSON.stringify({ prepared, usage }));
}
console.log(JSON.stringify({ apply, prepared, withCollege, usage }));
