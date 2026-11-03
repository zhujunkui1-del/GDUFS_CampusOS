// Read-only Preview corpus evaluation. Never reads personal conversations or credentials from D1.
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { previewCloudflareJson } from "./preview-network.mjs";

const phase = process.argv[2] || "baseline";
if (!/^(baseline|after)$/.test(phase)) throw Error("Use baseline or after");
const directory = "docs/verification/assistant-quality-2026-11-03";
await fs.mkdir(directory, { recursive: true });
await fs.mkdir(".map-tools/assistant-quality", { recursive: true });
const auth = execFileSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const token = JSON.parse(auth.slice(auth.indexOf("{"))).token;
const base =
  "https://api.cloudflare.com/client/v4/accounts/5328fbf5ef7ef40f7743723c2c192499";
const costs = [];
async function query(sql, params = []) {
  if (!/^\s*(SELECT|WITH|EXPLAIN)\b/i.test(sql))
    throw Error("Read-only evaluation");
  const [r] = await previewCloudflareJson(
    base + "/d1/database/18299abc-b38b-4494-8d12-8ab4d482c304/query",
    token,
    { sql, params },
  );
  if (!r.success) throw Error("Preview read failed");
  costs.push(r.meta);
  return r;
}
const db = {
  prepare(sql) {
    let params = [];
    const statement = {
      bind(...p) {
        params = p;
        return statement;
      },
      all() {
        return query(sql, params);
      },
      async first() {
        return (await query(sql, params)).results[0] || null;
      },
    };
    return statement;
  },
};
await build({
  stdin: {
    contents:
      "export {D1KeywordRetriever} from './src/lib/server/retrieval/retriever';export {contentIntent} from './src/lib/server/assistant/content-intent';export {inputGate} from './src/lib/server/assistant/input-gate';",
    resolveDir: phase === "baseline" ? process.cwd() + "/.map-tools/assistant-quality-baseline" : process.cwd(),
    loader: "ts",
  },
  outfile: ".map-tools/assistant-quality/runtime.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const lib = await import(
  pathToFileURL(process.cwd() + "/.map-tools/assistant-quality/runtime.mjs")
    .href
);
const corpusPath = directory + "/public-corpus.json";
let corpus;
try {
  corpus = JSON.parse(await fs.readFile(corpusPath, "utf8"));
} catch {
  // Stratify by actual business classification, rather than hand-picking passing titles.
  corpus = (
    await query(`WITH ranked AS (
 SELECT d.id,d.title,d.url,d.published_at,s.display_name,a.primary_destination,a.radar_category,a.knowledge_category,
 ROW_NUMBER() OVER(PARTITION BY a.primary_destination,COALESCE(a.radar_category,a.knowledge_category,'unknown') ORDER BY d.published_at DESC,d.id) AS n
 FROM console_public_documents d JOIN knowledge_sources s ON s.id=d.source_id
 JOIN console_article_classifications a ON a.document_id=d.id
 ) SELECT * FROM ranked WHERE n<=3 ORDER BY primary_destination,COALESCE(radar_category,knowledge_category,'unknown'),n LIMIT 45`)
  ).results;
  await fs.writeFile(corpusPath, JSON.stringify(corpus, null, 2));
}
const cases = corpus.flatMap((row, i) => [
  {
    id: `title-${i}`,
    message: `找文章《${row.title}》`,
    expectedId: row.id,
    kind: "exact_title",
  },
  {
    id: `short-${i}`,
    message: `找文章《${row.title.slice(0, Math.max(8, Math.ceil(row.title.length * 0.65)))}》`,
    expectedId: row.id,
    kind: "title_prefix",
  },
  {
    id: `oral-${i}`,
    message: `了解一下${row.title}`,
    expectedId: row.id,
    kind: "spoken_title",
  },
]);
cases.push({id:"wrapped-title",message:`请帮我找文章《${corpus[0].title}》`,expectedId:corpus[0].id,kind:"polite_title"});
const required = [
  "了解下王春业老师",
  "秋之声",
  "2026年的秋之声什么时候举行？",
  "最近有什么竞赛？",
  "看看广外最近的竞赛活动情况",
  "最近有什么讲座？",
  "了解下广外法学院的比赛",
  "2026年研究生学业奖学金拟获奖名单公示",
  "只能找到这两条吗？",
  "学院组织三下乡需要填申请表吗？",
  "党的二十届五中全会公报一图速览",
  "找文章「法通中外，三十启新＃一周一会＃第七周工作速览」",
  "广外学子在2025年全运会有什么贡献？",
  "今天广外有哪些活动？",
  "下周有什么可以参加的讲座？",
  "一饭在哪？",
  "带我去南苑11栋",
  "你好，你是一只大肥鱼吗？",
  "开启智能搜索后查找广外官网最新资料",
  "关闭智能搜索后再次查询校园文章",
];
const routes = required.map((message) => ({
  message,
  gate: lib.inputGate(message),
  plan: lib.contentIntent(message, [], Date.parse("2026-11-03T04:00:00+08:00")),
}));
await fs.writeFile(
  directory + `/${phase}-routing.json`,
  JSON.stringify(routes, null, 2),
);
let rows = [];
try {
  rows = JSON.parse(
    await fs.readFile(directory + `/${phase}-retrieval.json`, "utf8"),
  ).rows;
} catch {
  /* first run */
}
const retriever = new lib.D1KeywordRetriever(db);
for (const item of cases) {
  if (rows.some((row) => row.id === item.id)) continue;
  const plan = lib.contentIntent(item.message);
  const start = performance.now(),
    offset = costs.length;
  let result, error;
  try {
    result = await retriever.retrieve(
      {
        query: plan.retrievalQuery,
        ...(plan.articleQuery ? { title: plan.articleQuery } : {}),
        limit: 5,
      },
      { kind: "public" },
    );
  } catch (e) {
    error = e.message;
  }
  const hits = result?.hits || [];
  rows.push({
    ...item,
    gate: lib.inputGate(item.message),
    plan,
    recalled: hits.some((h) => h.documentId === item.expectedId),
    hits,
    error,
    latencyMs: Math.round(performance.now() - start),
    metrics: result?.metrics,
    rowsRead: costs.slice(offset).reduce((n, m) => n + (m.rows_read || 0), 0),
  });
  await fs.writeFile(
    directory + `/${phase}-retrieval.json`,
    JSON.stringify(
      {
        phase,
        mode: "live D1 lexical retrieval; not model or Vectorize acceptance",
        total: cases.length,
        completed: rows.length,
        recalled: rows.filter((r) => r.recalled).length,
        rows,
      },
      null,
      2,
    ),
  );
  console.log(
    `${phase} ${rows.length}/${cases.length} recalled=${rows.filter((r) => r.recalled).length} errors=${rows.filter((r) => r.error).length}`,
  );
}
const domains = await previewCloudflareJson(base + "/workers/domains", token);
await fs.writeFile(
  directory + "/domain-bindings.json",
  JSON.stringify(
    domains
      .filter((d) => d.hostname === "gdufs.ccwu.cc")
      .map(({ hostname, service, environment }) => ({
        hostname,
        service,
        environment,
      })),
    null,
    2,
  ),
);
