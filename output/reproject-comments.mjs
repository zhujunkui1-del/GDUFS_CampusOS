// Controlled Preview derived-data operations. No article or publication updates.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { parse } from "comment-json";
import { assertPreviewTarget } from "../scripts/preview-config.mjs";
import { previewCloudflareJson } from "../scripts/preview-network.mjs";
const dir="output", mode="targeted";
await build({stdin:{contents:'export {analyzeArticle} from "./src/lib/ingestion/article-analysis";export {analysisStatements} from "./src/lib/server/console/article-analysis";export {calendarInput} from "./src/lib/ingestion/calendar-extraction";',resolveDir:process.cwd()},outfile:"output/reproject-comments-bundle.mjs",bundle:true,platform:"node",format:"esm",logLevel:"silent"});
const api=await import("./reproject-comments-bundle.mjs");
const config = parse(fs.readFileSync("wrangler.jsonc", "utf8")),
  account = process.env.CLOUDFLARE_ACCOUNT_ID;
assertPreviewTarget(config, account);
const dbId = config.env.preview.d1_databases[0].database_id;
const rawAuth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { token } = JSON.parse(rawAuth.slice(rawAuth.indexOf("{")));
const usage = { rowsRead: 0, rowsWritten: 0, queries: 0 };
async function query(body) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`;
  let rows;
  if (mode === "--verify") {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    if (!j.success) {
      const safe = (j.errors || []).map((e) => ({
        code: e.code,
        message: String(e.message).slice(0, 600),
      }));
      fs.writeFileSync(
        dir + "/query-diagnostic-error.json",
        JSON.stringify(safe, null, 2),
      );
      throw Error(JSON.stringify(safe));
    }
    rows = j.result;
  } else
    rows = await previewCloudflareJson(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`,
      token,
      body,
    );
  for (const r of rows) {
    usage.rowsRead += r.meta.rows_read;
    usage.rowsWritten += r.meta.rows_written;
    usage.queries++;
  }
  return rows;
}
const db = {
  prepare(sql) {
    return {
      sql,
      params: [],
      bind(...args) {
        this.params = args;
        return this;
      },
      async all() {
        return (await query({ sql: this.sql, params: this.params }))[0];
      },
      async first() {
        return (await this.all()).results[0] || null;
      },
      async run() {
        return await this.all();
      },
    };
  },
  async batch(stmts) {
    return query({
      batch: stmts.map((s) => ({ sql: s.sql, params: s.params })),
    });
  },
};

const ids=["wx-a9fde65bf4a18d6db8ae515dd006727ad9ac2c36","wx-99e92fdd9954a33c51df1498a543c4047a587a9d"];
const rows=(await query({sql:"SELECT d.id,d.title,d.body,d.body_format,d.body_status,d.published_at,d.url,d.source_id,d.content_revision,d.input_hash,d.rights_scope,s.display_name,x.projection_hash,x.analysis_json,o.document_id AS override_id FROM console_public_documents d JOIN knowledge_sources s ON s.id=d.source_id JOIN document_article_analysis x ON x.document_id=d.id LEFT JOIN document_classification_overrides o ON o.document_id=d.id WHERE d.id IN (?,?)",params:ids}))[0].results;
if(rows.length!==2)throw Error("Expected two public records");
const changes=[];
for(const r of rows){
 const input=api.calendarInput({documentId:r.id,title:r.title,body:r.body,bodyFormat:r.body_format,bodyStatus:r.body_status,publishedAt:r.published_at,sourceId:r.source_id,sourceName:r.display_name,originalUrl:r.url});
 const result=api.analyzeArticle(input);
 const old=JSON.parse(r.analysis_json);
 const stages=result.activities.filter(a=>a.calendar?.eligible).map(a=>({startsAt:a.startsAt?.at||a.startsAt?.date,place:a.placeRaw,evidence:a.startsAt?.evidence}));
 console.log(JSON.stringify({id:r.id,classification:result.primaryDestination,category:result.radarCategory,stages,override:!!r.override_id}));
 if(r.override_id)throw Error("Manual classification override present");
 if(r.id===ids[0]&&(!stages.some(a=>a.startsAt==="2026-11-22T14:30:00+08:00")||stages.some(a=>a.startsAt?.startsWith("2026-11-12"))))throw Error("Final date not verified");
 if(r.id===ids[1]&&(result.primaryDestination!=="radar"||result.radarCategory!=="education_career"))throw Error("Sharing category not verified");
 if(r.id===ids[0]){result.primaryDestination=old.primaryDestination;result.radarCategory=old.radarCategory;result.knowledgeCategory=old.knowledgeCategory;}
 changes.push(...await api.analysisStatements(db,r.id,r.content_revision,r.input_hash,input,result,r.rights_scope,r.projection_hash));
}
if(process.argv.includes("--apply")) {await db.batch(changes); console.log("Applied guarded projections",usage.rowsWritten);}


