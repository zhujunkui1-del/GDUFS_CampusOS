import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
const scope =
  "s.console_managed=1 AND s.channel_type IN('official_web','wechat_subscription','wechat_service') AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'";
const statements = [
  {
    name: "origins",
    sql: `SELECT c.classification_origin,count(*) n FROM console_article_classifications c JOIN knowledge_documents d ON d.id=c.document_id JOIN knowledge_sources s ON s.id=d.source_id WHERE ${scope} GROUP BY c.classification_origin`,
  },
  {
    name: "versions",
    sql: `SELECT a.classifier_version,count(*) n,sum(a.has_registration) AS registration_articles FROM document_article_analysis a JOIN knowledge_documents d ON d.id=a.document_id AND d.input_hash=a.input_hash AND d.content_revision=a.content_revision JOIN knowledge_sources s ON s.id=d.source_id WHERE ${scope} GROUP BY a.classifier_version`,
  },
  {
    name: "tags",
    sql: `SELECT t.tag,count(*) n FROM document_tags t JOIN knowledge_documents d ON d.id=t.document_id AND d.content_revision=t.content_revision JOIN knowledge_sources s ON s.id=d.source_id WHERE ${scope} GROUP BY t.tag ORDER BY n DESC`,
  },
  {
    name: "registration",
    sql: "SELECT count(DISTINCT document_id) AS documents,count(*) AS windows FROM article_registration_windows WHERE ends_day IS NOT NULL",
  },
  {
    name: "public",
    sql: "SELECT c.primary_destination,count(*) n FROM console_public_documents d JOIN console_article_classifications c ON c.document_id=d.id GROUP BY c.primary_destination",
  },
  {
    name: "gate",
    sql: "SELECT earliest_import_day FROM console_engine_settings WHERE id='console-v2-settings'",
  },
];
const results = await previewCloudflareJson(
  `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${config.env.preview.d1_databases[0].database_id}/query`,
  token,
  { batch: statements.map((s) => ({ sql: s.sql, params: [] })) },
);
const report = {
  capturedAt: new Date().toISOString(),
  results: Object.fromEntries(
    results.map((r, i) => [
      statements[i].name,
      {
        rows: r.results,
        rowsRead: r.meta.rows_read,
        rowsWritten: r.meta.rows_written,
        durationMs: r.meta.duration,
      },
    ]),
  ),
};
const snapshot = JSON.parse(
  readFileSync("test-results/article-analysis/corpus.json", "utf8"),
);
const oldIds = new Set(snapshot.documents.map((d) => d.id));
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${config.env.preview.d1_databases[0].database_id}/query`;
const [ids] = await previewCloudflareJson(endpoint, token, {
  sql: `SELECT d.id FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id WHERE ${scope} ORDER BY d.id LIMIT 5000`,
  params: [],
});
const newIds = ids.results.map((r) => r.id).filter((id) => !oldIds.has(id));
report.newDocumentsSinceSnapshot = {
  snapshotAt: snapshot.capturedAt,
  rowsRead: ids.meta.rows_read,
  rowsWritten: ids.meta.rows_written,
  documents: [],
};
if (newIds.length) {
  const [details] = await previewCloudflareJson(endpoint, token, {
    sql: `SELECT d.id,d.title,d.url,d.publication_status,d.published_at,s.display_name,s.channel_type,a.classifier_version,c.primary_destination,c.radar_category,c.knowledge_category FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id JOIN document_article_analysis a ON a.document_id=d.id AND a.input_hash=d.input_hash AND a.content_revision=d.content_revision JOIN console_article_classifications c ON c.document_id=d.id WHERE d.id IN(${newIds
      .slice(0, 50)
      .map(() => "?")
      .join(",")})`,
    params: newIds.slice(0, 50),
  });
  report.newDocumentsSinceSnapshot.documents = details.results;
  report.newDocumentsSinceSnapshot.rowsRead += details.meta.rows_read;
}
const dir = "docs/verification/article-analysis-2026-10-25";
mkdirSync(dir, { recursive: true });
writeFileSync(
  dir + "/final-counts.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
