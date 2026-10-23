import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const input = process.argv[2] || "test-results/official-web-route-discovery-2026-10-23-all.jsonl",
  output = process.argv[3] || "docs/官网栏目入口发现-2026-10-23.md",
  rows = readFileSync(input, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line)),
  candidates = rows.flatMap((row) => row.candidates || []),
  confirmed = candidates.filter((item) => item.confirmedListPage),
  home200 = rows.filter((row) => row.homepageStatus === 200).length,
  rowsOf = [];
const safeText = (value) => String(value || "").replace(/[|\r\n]/g, " ").trim();

rowsOf.push(
  "# 官网栏目入口发现（2026-10-23）",
  "",
  "> 本报告由本地官网名录做只读入口勘查生成，没有查询或写入 Cloudflare D1。扫描只检查官网首页、robots.txt、同源 sitemap 和首页导航中较像文章栏目的少量路径；最多验证每站5个栏目候选。候选入口需要在“官网采集”中逐站确认后才会纳入采集规则。",
  "",
  `- 官网来源：${rows.length}`,
  `- 首页 HTTP 200：${home200}`,
  `- 发现的栏目/页面候选：${candidates.length}`,
  `- 返回 HTTP 200 且含至少3个文章样式链接的列表候选：${confirmed.length}`,
  `- 没有找到候选入口：${rows.filter((row) => !(row.candidates || []).length).length}`,
  `- 总外网请求数：${rows.reduce((sum, row) => sum + Number(row.requests || 0), 0)}`,
  "",
  "## 分站结果",
  "",
);

for (const row of rows) {
  rowsOf.push(
    `### ${safeText(row.sourceId)} · ${safeText(row.name)}`,
    "",
    `- 官网首页：[${safeText(row.websiteUrl)}](${row.websiteUrl})` ,
    `- robots：${row.robotsStatus ?? "未取得"}；首页：${row.homepageStatus ?? "未取得"}；请求：${row.requests}`,
  );
  const sites = row.candidates || [],
    verified = sites.filter((item) => item.confirmedListPage),
    unverified = sites.filter((item) => !item.confirmedListPage);
  if (verified.length) {
    rowsOf.push("- 列表页候选（已观察到文章样式链接）：");
    for (const item of verified)
      rowsOf.push(
        `  - [${safeText(item.label) || "文章栏目"}](${item.url}) · ${item.sampleArticleLinks} 个文章样式链接`,
      );
  }
  if (unverified.length) {
    rowsOf.push("- 其他栏目候选（尚未验证为文章列表）：");
    for (const item of unverified)
      rowsOf.push(
        `  - [${safeText(item.label) || "栏目候选"}](${item.url})${item.pageStatus ? ` · HTTP ${item.pageStatus}` : ""}`,
      );
  }
  const prefixes = row.sitemapArticlePaths || [];
  if (prefixes.length)
    rowsOf.push(
      `- Sitemap 中观察到的文章路径前缀：${prefixes.map((item) => `\`${item.prefix}\`（${item.sampleCount}）`).join("、")}`,
    );
  if (row.errors?.length)
    rowsOf.push(`- 待复核：${[...new Set(row.errors.map(safeText))].join("、")}`);
  if (!sites.length && !row.errors?.length)
    rowsOf.push("- 尚未发现明显的文章栏目链接；需继续检查站内多层菜单或人工指定入口。");
  rowsOf.push("");
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, rowsOf.join("\n") + "\n", "utf8");
console.log(JSON.stringify({ output, sources: rows.length, candidates: candidates.length, confirmed: confirmed.length }));
