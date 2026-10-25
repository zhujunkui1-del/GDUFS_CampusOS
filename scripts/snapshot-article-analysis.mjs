// Read-only bounded D1 snapshot; HTML stays local and is not rewritten in D1.
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
const id = config.env.preview.d1_databases[0].database_id,
  output = "test-results/article-analysis";
mkdirSync(output, { recursive: true });
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(auth.slice(auth.indexOf("{")));
const usage = { rowsRead: 0, rowsWritten: 0, queries: 0 };
async function query(sql, params = []) {
  if (!/^SELECT\b/.test(sql)) throw Error("Read only");
  const [r] = await previewCloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${id}/query`,
    token,
    { sql, params },
  );
  usage.rowsRead += r.meta.rows_read;
  usage.rowsWritten += r.meta.rows_written;
  usage.queries++;
  return r.results;
}
const bundle = path.resolve(output + "/text.mjs");
await build({
  stdin: {
    contents: 'export {articleText} from "./src/lib/ingestion/article-text";',
    resolveDir: process.cwd(),
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { articleText } = await import(pathToFileURL(bundle).href);
const ids = await query(
  "SELECT d.id FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND s.channel_type IN('official_web','wechat_subscription','wechat_service') ORDER BY d.id",
);
const documents = [];
for (let i = 0; i < ids.length; i += 20) {
  const chunk = ids.slice(i, i + 20).map((d) => d.id);
  const rows = await query(
    `SELECT d.id,d.title,d.body,d.body_format,d.body_status,d.published_at,d.url,d.source_id,s.display_name,s.channel_type,d.content_type,d.content_revision,d.input_hash,d.content_hash,d.version,d.radar_category,d.knowledge_category,d.publication_status,d.lifecycle_status FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE d.id IN(${chunk.map(() => "?").join(",")})`,
    chunk,
  );
  for (const d of rows) {
    const input = {
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
    };
    const text = articleText(input);
    documents.push({
      ...d,
      body: text.text,
      body_format: "plain",
      original_body_format: d.body_format,
      links: text.links,
    });
  }
  if (i % 200 === 0)
    console.log(
      JSON.stringify({ processed: documents.length, total: ids.length, usage }),
    );
}
const report = {
  capturedAt: new Date().toISOString(),
  target: "campusos-preview",
  usage,
  documents,
};
writeFileSync(output + "/corpus.json", JSON.stringify(report) + "\n");
console.log(
  JSON.stringify({
    documents: documents.length,
    usage,
    path: output + "/corpus.json",
  }),
);
