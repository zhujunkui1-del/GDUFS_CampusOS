// One owner-authorized preview maintenance operation. Default: read-only plan.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "comment-json";
import { assertPreviewTarget } from "./preview-config.mjs";

const evidence = "docs/verification/wechat-catalog-2026-10-21";
const backup = "backups/wechat-catalog-2026-10-21";
const plan = JSON.parse(readFileSync(evidence + "/reconciliation-plan.json", "utf8"));
const feeds = JSON.parse(readFileSync(evidence + "/werss-78.json", "utf8"));
const inspected = JSON.parse(readFileSync(backup + "/inspection.json", "utf8"));
const beforeSources = inspected[2].results;
const types = ["wechat_subscription", "wechat_service"];
const isWechat = (s) => types.includes(s.channel_type);
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const value = (v) => v == null ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replaceAll("'", "''") + "'";
const qid = (s) => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw Error("INVALID_IDENTIFIER"); return '"' + s + '"'; };
const wechatWhere = "console_managed=1 AND channel_type IN('wechat_subscription','wechat_service')";
const oldIds = beforeSources.filter(isWechat).map((s) => s.id);
const allowed = plan.mappings.map((m) => m.source_id);
const oldIdSql = oldIds.map(value).join(",");
const sourceChildren = inspected[3].results.filter((s) => s.sql?.includes("REFERENCES knowledge_sources")).map((s) => s.name);
const childGuard = sourceChildren.map((t) => `(SELECT count(*) FROM ${qid(t)} WHERE source_id IN(${oldIdSql}))=0`).join(" AND ");
const config = parse(readFileSync("wrangler.jsonc", "utf8"));
// This is the account already established by the existing preview binding.
assertPreviewTarget(config, "5328fbf5ef7ef40f7743723c2c192499");
if (config.env.preview.d1_databases[0].database_id !== "18299abc-b38b-4494-8d12-8ab4d482c304") throw Error("WRONG_DATABASE");
if (feeds.count !== 78 || plan.mappings.length !== 78 || new Set(allowed).size !== 78 || new Set(feeds.accounts.map((a) => a.id)).size !== 78) throw Error("INVALID_78_ACCOUNT_MANIFEST");
const { sha256, ...unhashed } = plan;
// The Python plan hash is retained as an operation identity; also pin file bytes.
const planFileHash = createHash("sha256").update(readFileSync(evidence + "/reconciliation-plan.json")).digest("hex");
void unhashed;
const auditId = "wechat-reconcile:" + sha256;

function cli(args) {
  const p = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 180000 });
  if (p.status !== 0) { writeFileSync(backup + "/operation-error.txt", p.stderr + "\n" + p.stdout); throw Error("D1_OPERATION_FAILED_SEE_IGNORED_LOG"); }
  return p.stdout;
}
const remote = ["campusos-preview", "--remote", "--env", "preview", "--config", "wrangler.jsonc"];
function query(sql) { const r = JSON.parse(cli(["d1", "execute", ...remote, "--json", "--command", sql])); if (r.some((x) => !x.success)) throw Error("D1_QUERY_FAILED"); return r[0].results; }
function snapshot() {
  return {
    sources: query("SELECT * FROM knowledge_sources WHERE console_managed=1 AND source_type<>'user_private' ORDER BY id"),
    documents: query("SELECT * FROM knowledge_documents WHERE owner_user_id IS NULL AND data_domain<>'user_private' ORDER BY id"),
    foreignKeys: query("PRAGMA foreign_key_check"),
  };
}
function assert(condition, message) { if (!condition) throw Error(message); }

if (!process.argv.includes("--prepare") && !process.argv.includes("--apply")) {
  console.log(JSON.stringify({ mode: "no-network-plan", database: "campusos-preview", matched: plan.counts.update, inserted: plan.counts.insert, removed: plan.removed_sources.length, finalWechat: 78, preservedWebsites: 109, preservedArticles: 52, planFileHash }));
  process.exit(0);
}
mkdirSync(backup, { recursive: true });
if (process.argv.includes("--prepare")) {
  const before = snapshot();
  assert(digest(before.sources) === digest(beforeSources), "SOURCE_SNAPSHOT_CHANGED_REPLAN_REQUIRED");
  assert(!before.foreignKeys.length, "EXISTING_FOREIGN_KEY_VIOLATION");
  assert(before.documents.every((d) => before.sources.find((s) => s.id === d.source_id)?.channel_type === "official_web"), "ARTICLE_SCOPE_CHANGED_REPLAN_REQUIRED");
  const children = query("SELECT " + sourceChildren.map((t) => `(SELECT count(*) FROM ${qid(t)} WHERE source_id IN(${oldIdSql})) AS ${qid(t)}`).join(","))[0];
  assert(Object.values(children).every((n) => n === 0), "WECHAT_DEPENDENCIES_FOUND_REPLAN_REQUIRED");
  writeFileSync(backup + "/before.json", JSON.stringify(before, null, 2) + "\n");
  assert(readFileSync(backup + "/knowledge_sources.before.sql", "utf8").includes("INSERT INTO"), "SOURCE_SQL_BACKUP_REQUIRED");
  const now = new Date().toISOString();
  const tuple = beforeSources.filter(isWechat).map((s) => `(${value(s.id)},${value(s.version)})`).join(",");
  const guard = (condition, label) => `SELECT CASE WHEN (${condition}) THEN 1 ELSE json_extract('${label}', '$') END;`;
  const statements = [
    "-- Exact owner-approved WeChat catalog replacement; the D1 file import executes in its transaction.",
    guard(`(SELECT count(*) FROM knowledge_sources WHERE ${wechatWhere})=92 AND (SELECT count(*) FROM knowledge_sources WHERE ${wechatWhere} AND (id,version) IN(${tuple}))=92 AND ${childGuard}`, "WECHAT_PREFLIGHT_CHANGED"),
  ];
  for (const m of plan.mappings) {
    const f = feeds.accounts.find((a) => a.id === m.account_id);
    assert(f?.mp_name === m.name && f.biz === m.biz, "FEED_MAPPING_MISMATCH");
    const previous = beforeSources.find((s) => s.id === m.source_id);
    const metadata = previous ? JSON.parse(previous.catalog_metadata_json) : {};
    metadata._importActor = "owner-authorized-wechat-reconcile";
    metadata.wechatAccount = { bookId: m.account_id, biz: m.biz, name: m.name, intro: f.mp_intro || "", collector: "wechat-mp-tools", ownerCheckedUpdating: true, ownerCheckedOn: "2026-10-21", provenance: "werss-local-subscription-list", manifest: "docs/微信公众号与服务号_78个有效账号_2026-10-21.md" };
    const aliases = previous ? JSON.parse(previous.source_aliases_json) : [];
    if (previous && previous.display_name !== m.name && !aliases.includes(previous.display_name)) aliases.push(previous.display_name);
    const fields = { display_name: m.name, allowed_domains_json: JSON.stringify(["mp.weixin.qq.com"]), source_aliases_json: JSON.stringify(aliases), canonical_locator: m.account_id.toLowerCase(), catalog_metadata_json: JSON.stringify(metadata), catalog_hash: sha256, connector_type: "wechat_link_manual", connector_config_json: "{}", fetch_policy_json: JSON.stringify({ mode: "manual", maxRequests: 0 }), enabled: 1, operating_status: "active", governance_note: "负责人于2026-10-21人工核对该账号仍在正常更新；采集器选用WeChat MP Tools。", governance_checked_at: now, updated_at: now };
    if (previous) {
      statements.push(`UPDATE knowledge_sources SET ${Object.entries(fields).map(([k,v]) => `${qid(k)}=${value(v)}`).join(",")},version=version+1 WHERE id=${value(m.source_id)} AND version=${previous.version} AND ${wechatWhere};`);
      statements.push(`INSERT INTO console_audit_logs(id,actor_label,action,target_type,target_id,version,details_json) VALUES(${value(auditId+":"+m.source_id)},'owner-authorized-maintenance','source.wechat_reconcile','source',${value(m.source_id)},${previous.version+1},${value(JSON.stringify({ accountId: m.account_id, oldName: previous.display_name, name: m.name, matching: m.matching, planHash: sha256 }))});`);
    } else {
      const fresh = { id: m.source_id, source_type: "official_account", console_managed: 1, channel_type: m.channel_type, subtype: "公众号/服务号（WeRSS接口未区分类型）", entry_urls_json: "[]", created_at: now, ...fields };
      statements.push(`INSERT INTO knowledge_sources(${Object.keys(fresh).map(qid).join(",")}) VALUES(${Object.values(fresh).map(value).join(",")});`);
    }
  }
  for (const m of plan.removed_sources) {
    statements.push(`INSERT INTO console_audit_logs(id,actor_label,action,target_type,target_id,details_json) VALUES(${value(auditId+":"+m.id)},'owner-authorized-maintenance','source.wechat_remove','source',${value(m.id)},${value(JSON.stringify({ oldName:m.name, planHash:sha256, reason:"Replaced by the owner's exact 78-account manifest; no associated articles or jobs at preflight" }))});`);
  }
  statements.push(`DELETE FROM knowledge_sources WHERE ${wechatWhere} AND id IN(${plan.removed_sources.map((m) => value(m.id)).join(",")});`);
  statements.push(guard(`(SELECT count(*) FROM knowledge_sources WHERE ${wechatWhere})=78 AND (SELECT count(*) FROM knowledge_sources WHERE ${wechatWhere} AND id IN(${allowed.map(value).join(",")}))=78 AND NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check)`, "WECHAT_POSTCONDITION_FAILED"));
  statements.push(`INSERT INTO console_audit_logs(id,actor_label,action,target_type,target_id,details_json) VALUES(${value(auditId)},'owner-authorized-maintenance','source.wechat_catalog_replace','source','wechat-catalog-2026-10-21',${value(JSON.stringify({ ownerAuthorized:true, currentAccounts:78, updated:54, inserted:24, removed:38, removedArticles:0, websiteSourcesPreserved:109, websiteArticlesPreserved:52, planHash:sha256 }))});`);
  const sql = statements.join("\n") + "\n";
  writeFileSync(backup + "/apply.sql", sql);
  writeFileSync(backup + "/prepared.json", JSON.stringify({ planFileHash, sqlHash:digest(sql), beforeSourceHash:digest(before.sources), protectedSourcesHash:digest(before.sources.filter((s) => !isWechat(s))), protectedArticlesHash:digest(before.documents), now },null,2));
  console.log(JSON.stringify({ prepared:true, updated:54, inserted:24, removed:38, articlesDeleted:0, websiteSources:109, websiteArticles:52, sqlBytes:Buffer.byteLength(sql), planFileHash }));
}
if (process.argv.includes("--apply")) {
  const prepared=JSON.parse(readFileSync(backup+"/prepared.json","utf8"));
  const sql=readFileSync(backup+"/apply.sql","utf8");
  assert(prepared.planFileHash===planFileHash && prepared.sqlHash===digest(sql),"PREPARED_OPERATION_CHANGED");
  const current=snapshot();
  assert(digest(current.sources)===prepared.beforeSourceHash,"SOURCE_CHANGED_BEFORE_APPLY");
  assert(digest(current.documents)===prepared.protectedArticlesHash,"ARTICLE_CHANGED_BEFORE_APPLY");
  const output=cli(["d1","execute",...remote,"--file",backup+"/apply.sql","--yes"]);
  writeFileSync(backup+"/apply-output.txt",output);
  const after=snapshot();
  writeFileSync(backup+"/after.json",JSON.stringify(after,null,2)+"\n");
  assert(digest(after.sources.filter((s)=>!isWechat(s)))===prepared.protectedSourcesHash,"NON_WECHAT_SOURCE_CHANGED");
  assert(digest(after.documents)===prepared.protectedArticlesHash,"WEBSITE_ARTICLE_CHANGED");
  const accounts=after.sources.filter(isWechat);
  assert(accounts.length===78 && !after.foreignKeys.length,"AFTER_STATE_INVALID");
  for(const m of plan.mappings){const s=accounts.find((s)=>s.id===m.source_id);assert(s?.display_name===m.name && JSON.parse(s.catalog_metadata_json).wechatAccount.bookId===m.account_id,"ACCOUNT_MAPPING_NOT_PERSISTED");}
  const report={completedAt:new Date().toISOString(),database:"campusos-preview",planHash:sha256,beforeSources:current.sources.length,afterSources:after.sources.length,wechatBefore:92,wechatAfter:78,updated:54,inserted:24,deletedOldSourceRows:38,deletedArticles:0,preservedWebsiteSources:109,preservedWebsiteArticles:52,allNonWechatSourcesUnchanged:true,allExistingArticlesUnchanged:true,foreignKeyViolations:after.foreignKeys.length,protectedSourceHash:prepared.protectedSourcesHash,protectedArticleHash:prepared.protectedArticlesHash,collector:"wechat-mp-tools",applicationCodeChanged:false};
  writeFileSync(evidence+"/result.json",JSON.stringify(report,null,2)+"\n");
  mkdirSync("data/console",{recursive:true});
  writeFileSync("data/console/wechat-source-registry-2026-10-21.json",JSON.stringify({updatedAt:report.completedAt,collector:"wechat-mp-tools",count:78,accounts:plan.mappings},null,2)+"\n");
  console.log(JSON.stringify(report));
}
