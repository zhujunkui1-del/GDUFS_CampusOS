// Preview-only recovery of already captured website articles. No upstream crawl.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";
import { previewCloudflareJson } from "./preview-network.mjs";

const since = process.argv.find((a) => a.startsWith("--since="))?.slice(8);
if (
  !since ||
  !/^\d{4}-\d{2}-\d{2}$/.test(since) ||
  new Date(since).toISOString().slice(0, 10) !== since
)
  throw new Error("An explicit valid --since=YYYY-MM-DD is required");
const apply = process.argv.includes("--apply"),
  config = parse(readFileSync("wrangler.jsonc", "utf8"));
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(config, account);
const databaseId = config.env.preview.d1_databases[0].database_id;
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(auth.slice(auth.indexOf("{")));
const call = (suffix, body) =>
  previewCloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${account}${suffix}`,
    token,
    body,
  );
const target = await call("/d1/database/" + databaseId);
if (target.name !== "campusos-preview" || target.uuid !== databaseId)
  throw new Error("Preview identity mismatch");
const usage = { rowsRead: 0, rowsWritten: 0, sqlCalls: 0 };
async function execute(body) {
  const results = await call(`/d1/database/${databaseId}/query`, body);
  for (const r of results) {
    if (!r.success) throw new Error("Database statement failed");
    usage.rowsRead += r.meta?.rows_read || 0;
    usage.rowsWritten += r.meta?.rows_written || 0;
    usage.sqlCalls++;
  }
  return results;
}
function statement(sql, params = []) {
  return {
    sql,
    params,
    bind(...values) {
      return statement(sql, values);
    },
    async all() {
      return (await execute({ sql, params }))[0];
    },
    async first() {
      return (await this.all()).results[0] || null;
    },
    async run() {
      return (await execute({ sql, params }))[0];
    },
  };
}
const db = {
  prepare: statement,
  async batch(statements) {
    return execute({
      batch: statements.map((s) => ({ sql: s.sql, params: s.params })),
    });
  },
};
const outputDir = "docs/verification/article-publication-backfill-2026-10-25";
mkdirSync(outputDir, { recursive: true });
mkdirSync("test-results", { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  target: "campusos-preview",
  since,
  apply,
  items: [],
  usage,
};
const save = () =>
  writeFileSync(
    outputDir + "/" + (apply ? "publication" : "preview") + ".json",
    JSON.stringify(report, null, 2) + "\n",
  );
if (apply) {
  const probe = await execute({
    batch: [
      { sql: "SELECT 1 AS n", params: [] },
      { sql: "SELECT 2 AS n", params: [] },
    ],
  });
  if (probe.length !== 2) throw new Error("D1 batch transport unavailable");
  const bundle = path.resolve("test-results/publish-collected-web.mjs");
  await build({
    stdin: {
      contents: `import {ConsoleAutomationStore} from "./src/lib/server/console/v2-automation";
        export {ConsoleAutomationStore}; export {ContentInputSchema} from "./src/domain/console/contracts";
        // Owner-directed correction of an existing capture uses the canonical
        // content/version/audit transaction, rather than the new-import workflow.
        export class CapturedDateRepair extends ConsoleAutomationStore {
          async repairDate(id,input){
            const current=await this.document(id);
            if(current.publishedAt || current.url!==input.url || current.sourceId!==input.sourceId)
              throw new Error("Only a missing date of the same existing capture may be restored");
            const prepared=await this.prepareContentWrite(id,input);
            return this.mutate(prepared.value,"document.edit","document",id,
              {...input,note:"依据原文补回缺失发布日期"},prepared.statements,"write",prepared.data.sourceId);
          }
        }`,
      resolveDir: process.cwd(),
    },
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  const { ConsoleAutomationStore, ContentInputSchema, CapturedDateRepair } =
    await import(pathToFileURL(bundle).href);
  const publisher = new ConsoleAutomationStore(db, {
    id: "sys-console-publisher",
    email: "publisher@system.invalid",
    role: "operator",
  });
  // Optional correction is backed by the actual original page, never title/year inference.
  const evidenceFile = process.argv
    .find((a) => a.startsWith("--date-evidence="))
    ?.slice(16);
  if (evidenceFile) {
    const admin = await db
      .prepare(
        "SELECT id,email,role FROM console_admins WHERE principal_type='human' AND role='admin' AND status='active' ORDER BY id LIMIT 1",
      )
      .first();
    if (!admin)
      throw new Error(
        "Active owner administrator required for date correction",
      );
    const owner = new CapturedDateRepair(db, admin);
    for (const e of JSON.parse(readFileSync(evidenceFile, "utf8"))) {
      const d = await owner.document(e.documentId);
      if (
        d.url !== e.url ||
        !e.rawDate ||
        !e.publishedAt ||
        e.publishedAt.slice(0, 10) < since
      )
        throw new Error("Date evidence mismatch");
      if (!d.publishedAt) {
        const input = ContentInputSchema.parse(
          Object.fromEntries(
            Object.keys(ContentInputSchema.shape).map((k) => [k, d[k]]),
          ),
        );
        await owner.repairDate(d.id, {
          ...input,
          publishedAt: e.publishedAt,
          commandId: crypto.randomUUID(),
          expectedVersion: d.version,
        });
        report.dateCorrections ||= [];
        report.dateCorrections.push({
          id: d.id,
          from: null,
          to: e.publishedAt,
          evidenceUrl: e.url,
        });
      }
    }
  }
  const rows = await db
    .prepare(
      `SELECT d.id,d.version FROM knowledge_sources s JOIN knowledge_documents d ON d.source_id=s.id
    LEFT JOIN console_document_controls x ON x.document_id=d.id
    WHERE s.console_managed=1 AND s.source_type='official_web' AND s.channel_type='official_web'
      AND s.enabled=1 AND s.archived_at IS NULL AND d.owner_user_id IS NULL AND d.data_domain<>'user_private'
      AND d.lifecycle_status='active' AND d.publication_status<>'published'
      AND (CASE WHEN length(d.published_at)=10 THEN d.published_at ELSE date(d.published_at,'+8 hours') END)>=?
      AND d.input_hash IS NOT NULL AND d.content_revision>0 AND length(d.body)>0
      AND x.hold_reason IS NULL AND x.review_hold IS NULL ORDER BY d.id`,
    )
    .bind(since)
    .all();
  report.selected = rows.results.length;
  save();
  if (rows.results.length) {
    const first = await publisher.publishCollectedWebArticle(
      rows.results[0].id,
    );
    if (!first.published)
      throw new Error("First publication did not become publicly visible");
    report.items.push(first);
    save();
  }
  // Independent documents use the same CAS transactions and audit as normal commits.
  let next = report.items.length;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < rows.results.length) {
        const row = rows.results[next++];
        try {
          report.items.push(await publisher.publishCollectedWebArticle(row.id));
        } catch (error) {
          report.items.push({
            id: row.id,
            published: false,
            error: error.message,
          });
        }
        save();
        if (report.items.length % 25 === 0)
          console.log(
            JSON.stringify({
              processed: report.items.length,
              total: report.selected,
              published: report.items.filter((i) => i.published).length,
              usage,
            }),
          );
      }
    }),
  );
} else {
  report.pending = (
    await db
      .prepare(
        "SELECT d.publication_status,count(*) AS n FROM knowledge_sources s JOIN knowledge_documents d ON d.source_id=s.id WHERE s.console_managed=1 AND s.source_type='official_web' AND s.channel_type='official_web' AND s.enabled=1 AND s.archived_at IS NULL AND d.owner_user_id IS NULL AND d.data_domain<>'user_private' AND (CASE WHEN length(d.published_at)=10 THEN d.published_at ELSE date(d.published_at,'+8 hours') END)>=? GROUP BY d.publication_status",
      )
      .bind(since)
      .all()
  ).results;
}
report.finishedAt = new Date().toISOString();
save();
console.log(
  JSON.stringify({
    ...report,
    items: undefined,
    published: report.items.filter((i) => i.published).length,
    failed: report.items.filter((i) => !i.published),
  }),
);
if (report.items.some((i) => !i.published)) process.exitCode = 1;
