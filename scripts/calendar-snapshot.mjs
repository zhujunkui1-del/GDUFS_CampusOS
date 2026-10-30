// Preview-only read snapshot. Raw HTML/evidence stays in the ignored local folder.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";
const config = parse(fs.readFileSync("wrangler.jsonc", "utf8")),
  account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(config, account);
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(auth.slice(auth.indexOf("{"))),
  db = config.env.preview.d1_databases[0].database_id;
const dir = ".map-tools/calendar-20261030";
fs.mkdirSync(dir, { recursive: true });
const usage = { rowsRead: 0, rowsWritten: 0, queries: 0 };
const query = async (sql, params = []) => {
  const [r] = await previewCloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`,
    token,
    { sql, params },
  );
  usage.rowsRead += r.meta.rows_read;
  usage.rowsWritten += r.meta.rows_written;
  usage.queries++;
  return r.results;
};
const ids = await query("SELECT id FROM console_public_documents ORDER BY id"),
  documents = [];
for (let i = 0; i < ids.length; i += 20) {
  const selected = ids.slice(i, i + 20).map((x) => x.id);
  const rows = await query(
    `SELECT d.id,d.title,CASE WHEN d.rights_scope IN('licensed_full_text','excerpt_and_link') THEN d.body ELSE '' END AS body,d.body_format,d.body_status,d.published_at,d.url,d.source_id,s.display_name,s.channel_type,d.content_type,d.content_revision,d.input_hash,d.version,d.rights_scope,a.analysis_json,a.projection_hash FROM knowledge_documents d JOIN knowledge_sources s ON s.id=d.source_id LEFT JOIN document_article_analysis a ON a.document_id=d.id AND a.content_revision=d.content_revision AND a.input_hash=d.input_hash WHERE d.id IN(${selected.map(() => "?").join(",")})`,
    selected,
  );
  documents.push(...rows);
  if (i % 200 === 0)
    console.log(
      JSON.stringify({ read: documents.length, total: ids.length, usage }),
    );
}
fs.writeFileSync(
  dir + "/snapshot.json",
  JSON.stringify({
    capturedAt: new Date().toISOString(),
    target: "campusos-preview",
    baselineCommit: process.argv[2] || null,
    usage,
    documents,
  }),
);
console.log(
  JSON.stringify({
    documents: documents.length,
    usage,
    path: dir + "/snapshot.json",
  }),
);
