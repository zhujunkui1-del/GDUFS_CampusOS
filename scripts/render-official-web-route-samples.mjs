import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const input = process.argv[2] || "test-results/official-web-list-samples-2026-10-23.jsonl",
  output = process.argv[3] || "docs/官网文章路径抽样-2026-10-23.md",
  rows = readFileSync(input, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line)),
  candidates = rows.flatMap((row) => row.candidates || []),
  links = candidates.flatMap((candidate) => candidate.articleLinks || []),
  verifiedPages = candidates.filter((candidate) => (candidate.articleLinks || []).length >= 3),
  outputLines = [];
const safe = (value) => String(value || "").replace(/[|\r\n]/g, " ").trim();

outputLines.push(
  "# 官网列表页文章路径抽样（2026-10-23）",
  "",
  "> 只读样本报告：逐一请求已初筛的同源列表候选，确认可访问并提取少量文章链接。没有保存文章正文、没有写入 D1，也没有自动启用任何来源。样本用于帮助管理员配置文章路径，不能证明栏目完整或许可已批准。",
  "",
  `- 抽样来源：${rows.length}`,
  `- 检查列表页：${candidates.length}`,
  `- 返回 HTTP 200 且发现至少3个文章链接：${verifiedPages.length}`,
  `- 样本文章链接：${links.length}`,
  `- 样本文章路径前缀：${candidates.reduce((sum, item) => sum + (item.articlePathPrefixes || []).length, 0)}`,
  "",
);
for (const row of rows) {
  outputLines.push(`## ${safe(row.sourceId)} · ${safe(row.name)}`, "");
  if (row.errors?.length)
    outputLines.push(`- robots/站点错误：${[...new Set(row.errors.map(safe))].join("、")}`);
  for (const candidate of row.candidates || []) {
    outputLines.push(
      `### [${safe(candidate.label) || "栏目"}](${candidate.url})`,
      "",
      `- 列表页状态：${candidate.status ?? "未完成"}；文章链接样本：${(candidate.articleLinks || []).length}`,
    );
    if (candidate.articlePathPrefixes?.length)
      outputLines.push(
        `- 可考虑配置的路径前缀：${candidate.articlePathPrefixes.map((item) => `\`${item.prefix}\`（样本${item.samples}）`).join("、")}`,
      );
    if (candidate.articleLinks?.length) {
      outputLines.push("- 文章链接样本：");
      for (const url of candidate.articleLinks)
        outputLines.push(`  - [${safe(url)}](${url})`);
    }
    if (candidate.error) outputLines.push(`- 请求状态：${safe(candidate.error)}`);
    outputLines.push("");
  }
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, outputLines.join("\n") + "\n", "utf8");
console.log(JSON.stringify({ output, sources: rows.length, listPages: candidates.length, articleLinks: links.length }));
