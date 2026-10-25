import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";
const config = parse(readFileSync("wrangler.jsonc", "utf8")),
  account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(config, account);
const output = "docs/verification/article-analysis-2026-10-25";
mkdirSync(output, { recursive: true });
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(auth.slice(auth.indexOf("{")));
const usage = { rowsRead: 0, rowsWritten: 0, queries: 0 },
  id = config.env.preview.d1_databases[0].database_id;
async function query(sql, params = []) {
  if (!/^(SELECT|EXPLAIN)\b/.test(sql)) throw Error("Read-only verifier");
  const [r] = await previewCloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${id}/query`,
    token,
    { sql, params },
  );
  usage.rowsRead += r.meta.rows_read;
  usage.rowsWritten += r.meta.rows_written;
  usage.queries++;
  return r;
}
const application = JSON.parse(
    readFileSync("test-results/article-analysis/application.json", "utf8"),
  ),
  changes = [];
for (let i = 0; i < application.applied.length; i += 20) {
  const chunk = application.applied.slice(i, i + 20);
  const r = await query(
    `SELECT id,input_hash,content_revision,content_hash,publication_status,lifecycle_status,version FROM knowledge_documents WHERE id IN(${chunk.map(() => "?").join(",")})`,
    chunk.map((x) => x.id),
  );
  for (const x of chunk) {
    const after = r.results.find((r) => r.id === x.id);
    const keys = [
      "input_hash",
      "content_revision",
      "content_hash",
      "publication_status",
      "lifecycle_status",
      "version",
    ];
    if (!after || keys.some((k) => x.before[k] !== after[k]))
      changes.push({ id: x.id, before: x.before, after });
  }
}
const counts = await query(
  "SELECT c.primary_destination,c.radar_category,c.knowledge_category,count(*) AS n,sum(c.has_registration) AS registration FROM console_article_classifications c JOIN knowledge_documents d ON d.id=c.document_id JOIN knowledge_sources s ON s.id=d.source_id WHERE s.console_managed=1 AND s.channel_type IN('official_web','wechat_subscription','wechat_service') GROUP BY c.primary_destination,c.radar_category,c.knowledge_category",
);
const publicCounts = await query(
  "SELECT c.primary_destination,count(*) AS n FROM console_public_documents d JOIN console_article_classifications c ON c.document_id=d.id GROUP BY c.primary_destination",
);
const plans = await query(
  "EXPLAIN QUERY PLAN SELECT document_id FROM article_activity_index WHERE category='competition' AND starts_day>='2026-10-25' AND starts_day<='2026-11-30' LIMIT 10",
);
const report = {
  capturedAt: new Date().toISOString(),
  usage,
  applied: application.applied.length,
  sourceChangesDuringProjection: changes,
  counts: counts.results,
  publicCounts: publicCounts.results,
  queryPlan: plans.results,
  applicationUsage: application.usage,
};
writeFileSync(
  output + "/database-verification.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
