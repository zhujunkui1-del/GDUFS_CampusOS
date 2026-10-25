// Preview-only maintenance. Credentials stay in memory; no source HTML is logged.
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { previewCloudflareJson } from "./preview-network.mjs";
const argv = process.argv.slice(2),
  mode = argv[0] || "status",
  flag = (name, otherwise) => {
    const p = argv.indexOf(name);
    return p < 0 ? otherwise : argv[p + 1];
  };
if (!["status", "backfill", "search", "explain"].includes(mode))
  throw Error("Use status, backfill, search or explain");
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const token = JSON.parse(auth.slice(auth.indexOf("{"))).token;
if (!token) throw Error("Cloudflare authentication unavailable");
const url =
  "https://api.cloudflare.com/client/v4/accounts/5328fbf5ef7ef40f7743723c2c192499/d1/database/18299abc-b38b-4494-8d12-8ab4d482c304/query";
const costs = [];
async function query(sql, params = []) {
  const results = await previewCloudflareJson(url, token, { sql, params });
  const r = results[0];
  if (!r?.success) throw Error("Preview query failed");
  costs.push({
    kind: sql.includes("FROM article_chunk_fts")
      ? "fts"
      : sql.startsWith("WITH selected")
        ? sql.includes("JOIN article_search_documents")
          ? "evidence"
          : "public_gate"
        : "maintenance",
    read: r.meta?.rows_read || 0,
    written: r.meta?.rows_written || 0,
    durationMs: r.meta?.duration || 0,
  });
  return r;
}
const db = {
  prepare(sql) {
    let params = [];
    const s = {
      sql,
      get params() {
        return params;
      },
      bind(...p) {
        params = p;
        return s;
      },
      all() {
        return query(sql, params);
      },
      async first() {
        return (await query(sql, params)).results[0] || null;
      },
      run() {
        return query(sql, params);
      },
    };
    return s;
  },
  async batch(statements) {
    const r = await previewCloudflareJson(url, token, {
      batch: statements.map((s) => ({ sql: s.sql, params: s.params })),
    });
    for (const v of r) {
      if (!v.success) throw Error("Preview index transaction failed");
      costs.push({
        read: v.meta?.rows_read || 0,
        written: v.meta?.rows_written || 0,
        durationMs: v.meta?.duration || 0,
      });
    }
    return r;
  },
};
await fs.mkdir("test-results/retrieval", { recursive: true });
const outfile = path.resolve("test-results/retrieval/maintenance.mjs");
await build({
  stdin: {
    contents:
      "export {ensureRetrievalIndex,retrievalIndexStatements} from './src/lib/server/retrieval/indexer'; export {D1KeywordRetriever,currentPublicArticles} from './src/lib/server/retrieval/retriever';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const lib = await import(pathToFileURL(outfile).href + "?" + Date.now());
const output = { mode, at: new Date().toISOString() };
if (mode === "status") {
  output.counts = (
    await query(
      "SELECT status,index_version,count(*) AS n,sum(chunk_count) AS chunks FROM article_search_documents GROUP BY status,index_version",
    )
  ).results;
  output.public = (
    await query(
      "SELECT c.primary_destination,s.channel_type,count(*) AS n FROM console_public_documents d JOIN knowledge_sources s ON s.id=d.source_id JOIN console_article_classifications c ON c.document_id=d.id GROUP BY c.primary_destination,s.channel_type",
    )
  ).results;
} else if (mode === "backfill") {
  const count = Number(flag("--limit", "25"));
  if (!Number.isInteger(count) || count < 1 || count > 2000)
    throw Error("Limit must be 1..2000");
  let cursor = flag("--after", ""),
    changed = 0,
    processed = 0;
  while (processed < count) {
    const selected = await query(
      "SELECT d.id,d.title,d.body,d.body_format,d.body_status,d.source_id,d.url,d.published_at,d.rights_scope,d.content_revision,d.input_hash,s.display_name,0 AS current FROM knowledge_documents d CROSS JOIN knowledge_sources s ON s.id=d.source_id WHERE d.id>? AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND s.console_managed=1 AND d.input_hash IS NOT NULL AND d.rights_scope IN('metadata_only','excerpt_and_link','licensed_full_text') AND NOT EXISTS(SELECT 1 FROM article_search_documents r WHERE r.document_id=d.id AND r.content_revision=d.content_revision AND r.input_hash=d.input_hash AND r.index_version='campus-fts-v1' AND r.status='ready') ORDER BY d.id LIMIT ?",
      [cursor, Math.min(20, count - processed)],
    );
    if (!selected.results.length) break;
    let pending = [];
    for (const d of selected.results) {
      if (!d.current) {
        const statements = await lib.retrievalIndexStatements(
          db,
          d.id,
          d.content_revision,
          d.input_hash,
          {
            title: d.title,
            body: d.body || "",
            bodyFormat:
              d.body_format === "reading_html" ? "reading_html" : "plain",
            bodyStatus: d.body_status,
            sourceId: d.source_id,
            sourceName: d.display_name,
            originalUrl: d.url,
            publishedAt: d.published_at,
          },
          d.rights_scope,
        );
        if (pending.length + statements.length > 90 && pending.length) {
          await db.batch(pending);
          pending = [];
        }
        pending.push(...statements);
        changed++;
      }
      processed++;
      cursor = d.id;
    }
    if (pending.length) await db.batch(pending);
    console.log(
      JSON.stringify({
        processed,
        changed,
        cursor,
        rowsRead: costs.reduce((n, r) => n + r.read, 0),
        rowsWritten: costs.reduce((n, r) => n + r.written, 0),
      }),
    );
    await fs.writeFile(
      "test-results/retrieval/backfill-cursor.json",
      JSON.stringify({
        cursor,
        processed,
        changed,
        at: new Date().toISOString(),
      }),
    );
  }
  Object.assign(output, { processed, changed, cursor });
} else if (mode === "search") {
  output.result = await new lib.D1KeywordRetriever(db).retrieve(
    {
      purpose: flag("--purpose", "knowledge"),
      query: flag("--query", "图书馆借阅规则"),
      limit: Number(flag("--limit", "4")),
    },
    { kind: "public" },
  );
} else {
  output.plan = (
    await query(
      "EXPLAIN QUERY PLAN SELECT k.document_id,k.id FROM article_chunk_fts JOIN knowledge_chunks k ON k.rowid=article_chunk_fts.rowid WHERE article_chunk_fts MATCH ? AND rank MATCH 'bm25(4.0,1.0,0.0)' ORDER BY rank LIMIT 96",
      ["h56fex4e66"],
    )
  ).results;
  output.gatePlan = await lib.currentPublicArticles(
    db,
    ["wx-e65f3688d0c219ed305ca5c944f2751660067122"],
    (sql, params) => query("EXPLAIN QUERY PLAN " + sql, params),
  );
}
output.cost = {
  rowsRead: costs.reduce((n, r) => n + r.read, 0),
  rowsWritten: costs.reduce((n, r) => n + r.written, 0),
  queries: costs.length,
  sqlDurationMs: costs.reduce((n, r) => n + r.durationMs, 0),
};
if (mode === "search") output.cost.queriesByStage = costs;
await fs.writeFile(
  flag("--output", "test-results/retrieval/" + mode + ".json"),
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify(output, null, 2));
