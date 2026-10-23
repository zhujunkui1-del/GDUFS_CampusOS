import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseHTML } from "linkedom";
import type { WebProfile } from "../src/lib/ingestion/profiles";
import { SafeWebFetcher } from "../src/lib/ingestion/safe-fetch";
import { robotsAllow, robotsCrawlDelay } from "../src/lib/ingestion/robots";

type Candidate = {
  url: string;
  label: string;
  confirmedListPage: boolean;
  sampleArticleLinks: number | null;
};
type DiscoveryRow = {
  sourceId: string;
  name: string;
  websiteUrl: string;
  candidates: Candidate[];
};

const args = process.argv.slice(2),
  option = (key: string) => {
    const index = args.indexOf(key);
    return index < 0 ? undefined : args[index + 1];
  };
if (!args.includes("--run")) {
  console.log(
    JSON.stringify({
      mode: "dry-run-no-network",
      usage: "node scripts/inspect-official-web-list-samples.mjs --run",
    }),
  );
  process.exit(0);
}
const input = option("--input") || "docs/官网栏目入口发现-2026-10-23.md",
  output =
    option("--output") ||
    "test-results/official-web-list-samples-2026-10-23.jsonl",
  sourceFilter = option("--source"),
  sourceFilters = new Set(
    (option("--sources") || "").split(",").filter(Boolean),
  ),
  includeUnconfirmed = args.includes("--include-unconfirmed"),
  candidateLimit = Number(option("--candidate-limit") || 0),
  limit = Number(option("--limit") || 0),
  inputText = readFileSync(input, "utf8"),
  rows = input.endsWith(".md")
    ? parseRouteReport(inputText)
    : inputText
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as DiscoveryRow)
        .filter((row) =>
          row.candidates?.some(
            (candidate) => includeUnconfirmed || candidate.confirmedListPage,
          ),
        );
mkdirSync(dirname(output), { recursive: true });
const lastRequest = new Map<string, number>(),
  minDelay = new Map<string, number>();

function parseRouteReport(markdown: string): DiscoveryRow[] {
  const rows: DiscoveryRow[] = [];
  let current: DiscoveryRow | null = null,
    mode: "none" | "confirmed" | "other" = "none";
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(GDUFS-SRC-[\w-]+)\s+·\s+(.*)$/);
    if (heading) {
      if (current) rows.push(current);
      current = {
        sourceId: heading[1],
        name: heading[2],
        websiteUrl: "",
        candidates: [],
      };
      mode = "none";
      continue;
    }
    if (!current) continue;
    const homepage = line.match(/^- 官网首页：\[[^\]]*\]\((https:\/\/[^)]+)\)/);
    if (homepage) {
      current.websiteUrl = homepage[1];
      continue;
    }
    if (line.startsWith("- 列表页候选")) {
      mode = "confirmed";
      continue;
    }
    if (line.startsWith("- 其他栏目候选")) {
      mode = "other";
      continue;
    }
    const candidate = line.match(/^\s+-\s+\[([^\]]*)\]\((https:\/\/[^)]+)\)/);
    if (!candidate || mode === "none") continue;
    current.candidates.push({
      url: candidate[2],
      label: candidate[1],
      confirmedListPage: mode === "confirmed",
      sampleArticleLinks: null,
    });
  }
  if (current) rows.push(current);
  return rows.filter((row) => row.websiteUrl);
}

function sameOrigin(raw: string, base: URL) {
  try {
    const url = new URL(raw, base);
    if (
      url.origin !== base.origin ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      [...url.searchParams.keys()].some((key) =>
        /^(uin|key|pass_ticket|appmsg_token|token|code)$/i.test(key),
      )
    )
      return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function findArticleLinks(html: string, listUrl: string, origin: URL) {
  const { document } = parseHTML(html),
    links = new Set<string>();
  for (const anchor of document.querySelectorAll("a[href]")) {
    const url = sameOrigin(anchor.getAttribute("href") || "", origin);
    if (!url) continue;
    const path = new URL(url).pathname,
      label = (anchor.textContent || "").replace(/\s+/g, " ").trim();
    if (
      /(?:\/info\/\d+\/\d+|\/\d{5,})\.(?:s?html?|shtml?)$/i.test(path) ||
      (/\.((s?html?)|shtml?)$/i.test(path) && /20\d{2}|\d{4,}/.test(path)) ||
      /阅读全文|详细内容|查看原文/.test(label)
    )
      links.add(url);
  }
  return [...links].filter((url) => url !== listUrl);
}

function prefixesFor(urls: string[]) {
  const counts = new Map<string, number>();
  for (const value of urls) {
    const path = new URL(value).pathname,
      prefix = path.replace(/[^/]*$/, "");
    counts.set(prefix, (counts.get(prefix) || 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([prefix, samples]) => ({ prefix, samples }));
}

async function inspect(row: DiscoveryRow) {
  const base = new URL(row.websiteUrl),
    candidates = row.candidates
      .filter((candidate) => includeUnconfirmed || candidate.confirmedListPage)
      .slice(0, candidateLimit || undefined),
    profile: WebProfile = {
      sourceId: row.sourceId,
      name: row.name,
      origin: base.origin,
      entryUrl: candidates[0].url,
      entryUrls: candidates.map((candidate) => candidate.url),
      ruleVersion: "route-sample-readonly",
      titleSelector: "h1, title",
      titleSuffix: "",
      dateSelector: "time, .date, .time",
      dateLabel: "发布时间",
      bodySelector: "article, main",
      detailPath: "",
      detailPathPrefixes: [],
      allowQueryUrls: true,
      requestIntervalMs: 1000,
    },
    fetcher = new SafeWebFetcher(profile, Number.MAX_SAFE_INTEGER, 0);
  fetcher.beforeRequest = async () => {
    const delay = Math.max(
        profile.requestIntervalMs || 1000,
        minDelay.get(base.origin) || 0,
      ),
      previous = lastRequest.get(base.origin) || 0,
      wait = delay - (Date.now() - previous);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest.set(base.origin, Date.now());
  };
  const result = {
    sourceId: row.sourceId,
    name: row.name,
    checkedAt: new Date().toISOString(),
    robotsStatus: null as number | null,
    candidates: [] as {
      url: string;
      label: string;
      status: number | null;
      articleLinks: string[];
      articlePathPrefixes: { prefix: string; samples: number }[];
      error: string | null;
    }[],
    errors: [] as string[],
  };
  try {
    const robots = await fetcher.get(base.origin + "/robots.txt", "robots");
    result.robotsStatus = robots.status;
    minDelay.set(
      base.origin,
      Math.max(
        profile.requestIntervalMs || 1000,
        robotsCrawlDelay(robots.html),
      ),
    );
    const allowed = candidates.filter((candidate) => {
      const url = new URL(candidate.url);
      return robots.html ? robotsAllow(robots.html, url.pathname) : true;
    });
    for (const candidate of allowed) {
      try {
        const page = await fetcher.get(candidate.url, "list"),
          links =
            page.status === 200
              ? findArticleLinks(page.html, candidate.url, base).slice(0, 5)
              : [];
        result.candidates.push({
          url: candidate.url,
          label: candidate.label,
          status: page.status,
          articleLinks: links,
          articlePathPrefixes: prefixesFor(links),
          error: null,
        });
      } catch (error) {
        result.candidates.push({
          url: candidate.url,
          label: candidate.label,
          status: null,
          articleLinks: [],
          articlePathPrefixes: [],
          error: error instanceof Error ? error.message : "REQUEST_FAILED",
        });
      }
    }
  } catch (error) {
    result.errors.push(
      error instanceof Error ? error.message : "ROBOTS_FAILED",
    );
  }
  return result;
}

const selectedRows = rows
  .filter((row) => !sourceFilter || row.sourceId === sourceFilter)
  .filter((row) => !sourceFilters.size || sourceFilters.has(row.sourceId))
  .filter((row) =>
    row.candidates.some(
      (candidate) => includeUnconfirmed || candidate.confirmedListPage,
    ),
  )
  .slice(0, limit || undefined);
for (let offset = 0; offset < selectedRows.length; offset += 4) {
  const results = await Promise.all(
    selectedRows.slice(offset, offset + 4).map(inspect),
  );
  for (const [index, result] of results.entries()) {
    appendFileSync(output, JSON.stringify(result) + "\n");
    console.log(
      JSON.stringify({
        done: offset + index + 1,
        total: selectedRows.length,
        sourceId: result.sourceId,
        candidates: result.candidates.length,
        validated: result.candidates.filter(
          (candidate) =>
            candidate.status === 200 && candidate.articleLinks.length >= 3,
        ).length,
      }),
    );
  }
}
