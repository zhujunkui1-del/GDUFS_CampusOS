import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseHTML } from "linkedom";
import type { WebProfile } from "../src/lib/ingestion/profiles";
import { SafeWebFetcher } from "../src/lib/ingestion/safe-fetch";
import { robotsAllow, robotsCrawlDelay } from "../src/lib/ingestion/robots";

type CatalogRecord = {
  id: string;
  input: {
    sourceType: string;
    displayName: string;
    websiteUrl: string | null;
  };
};
type RouteCandidate = {
  url: string;
  label: string;
  discoveredFrom: "homepage" | "sitemap";
  sampleArticleLinks: number | null;
  pageStatus: number | null;
  confirmedListPage: boolean;
};

const KEYWORDS = /新闻|通知|公告|动态|资讯|讲座|竞赛|招聘|招生|办事|公示|工作|学术|研究|报奖|活动/i;
const PATH_HINTS = /news|notice|tzgg|xwzx|xwdt|xxdt|tongzhi|bulletin|list|article|info/i;
const ARTICLE_PATH = /(?:\/info\/\d+\/\d+|\/\d{5,})\.(?:s?html?|shtml?)$/i;
const args = process.argv.slice(2);
const option = (key: string) => {
  const index = args.indexOf(key);
  return index < 0 ? undefined : args[index + 1];
};
if (!args.includes("--run")) {
  console.log(
    JSON.stringify({
      mode: "dry-run-no-network",
      usage: "node scripts/discover-official-web-routes.mjs --run [--limit N] [--source GDUFS-SRC-0001]",
      source: "local official_web catalog",
      crawlerNetwork: false,
    }),
  );
  process.exit(0);
}
const catalogPath = option("--catalog") || "data/console/source-catalog-2026-10-17.json";
const outputPath = option("--output") || "test-results/official-web-route-discovery-2026-10-23.jsonl";
const sourceFilter = option("--source");
const limit = Number(option("--limit") || 0);
const lastRequestByOrigin = new Map<string, number>(),
  delayByOrigin = new Map<string, number>();
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
  records: CatalogRecord[];
};
const sources = catalog.records
  .filter((record) => record.input.sourceType === "official_web")
  .filter((record) => !sourceFilter || record.id === sourceFilter)
  .slice(0, limit || undefined);
mkdirSync(dirname(outputPath), { recursive: true });

function safeSameOrigin(raw: string, base: URL) {
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

function articleLike(url: string, label = "") {
  return (
    ARTICLE_PATH.test(new URL(url).pathname) ||
    /\.((s?html?)|shtml?)$/i.test(new URL(url).pathname) &&
      /20\d{2}|\d{4,}/.test(new URL(url).pathname) ||
    /阅读全文|详细内容|查看原文/.test(label)
  );
}

function pageCandidates(html: string, pageUrl: string, origin: URL) {
  const { document } = parseHTML(html),
    candidates = new Map<string, string>();
  for (const anchor of document.querySelectorAll("a[href]")) {
    const url = safeSameOrigin(anchor.getAttribute("href") || "", origin);
    if (!url || articleLike(url, anchor.textContent || "")) continue;
    const label = (anchor.textContent || "").replace(/\s+/g, " ").trim();
    const path = new URL(url).pathname;
    if (
      KEYWORDS.test(label) ||
      PATH_HINTS.test(path) ||
      /下一页|下页/.test(label)
    )
      candidates.set(url, label.slice(0, 120));
  }
  return [...candidates].filter(([url]) => url !== pageUrl);
}

function pageArticleLinks(html: string, base: URL) {
  const { document } = parseHTML(html),
    links = new Set<string>();
  for (const anchor of document.querySelectorAll("a[href]")) {
    const url = safeSameOrigin(anchor.getAttribute("href") || "", base);
    if (url && articleLike(url, anchor.textContent || "")) links.add(url);
  }
  return [...links];
}

function sitemapLocations(xml: string, origin: URL) {
  const urls: string[] = [];
  for (const match of xml.matchAll(/<loc[^>]*>\s*([^<]+?)\s*<\/loc>/gi)) {
    const candidate = safeSameOrigin(
      match[1].replace(/&amp;/g, "&").trim(),
      origin,
    );
    if (candidate && !urls.includes(candidate)) urls.push(candidate);
  }
  return urls;
}

function routePrefixes(urls: string[]) {
  const counts = new Map<string, number>();
  for (const value of urls) {
    const url = new URL(value),
      match = url.pathname.match(/^(.*\/)(?:\d{4,}|\d+\.html?|index\.html?)$/i),
      prefix = match?.[1];
    if (prefix && !ARTICLE_PATH.test(url.pathname)) continue;
    const articlePrefix = prefix || url.pathname.replace(/[^/]*$/, "");
    counts.set(articlePrefix, (counts.get(articlePrefix) || 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([prefix, count]) => ({ prefix, sampleCount: count }));
}

async function inspect(record: CatalogRecord) {
  const started = new Date().toISOString(),
    result: Record<string, unknown> = {
      sourceId: record.id,
      name: record.input.displayName,
      websiteUrl: record.input.websiteUrl,
      checkedAt: started,
      robotsStatus: null,
      homepageStatus: null,
      sitemapUrls: [] as string[],
      sitemapArticlePaths: [] as { prefix: string; sampleCount: number }[],
      candidates: [] as RouteCandidate[],
      errors: [] as string[],
      requests: 0,
    };
  if (!record.input.websiteUrl) {
    result.errors = ["MISSING_HOMEPAGE"];
    return result;
  }
  let homepage: URL;
  try {
    homepage = new URL(record.input.websiteUrl);
  } catch {
    result.errors = ["INVALID_HOMEPAGE"];
    return result;
  }
  if (homepage.protocol !== "https:" || homepage.username || homepage.password || homepage.port) {
    result.errors = ["HTTPS_OR_HOST_REVIEW_REQUIRED"];
    return result;
  }
  const profile: WebProfile = {
    sourceId: record.id,
    name: record.input.displayName,
    origin: homepage.origin,
    entryUrl: homepage.toString(),
    entryUrls: [homepage.toString()],
    ruleVersion: "route-discovery-read-only",
    titleSelector: "h1, title",
    titleSuffix: "",
    dateSelector: "time, .date, .time",
    dateLabel: "发布时间",
    bodySelector: "article, main",
    detailPath: "",
    allowQueryUrls: true,
    requestIntervalMs: 1000,
  };
  const fetcher = new SafeWebFetcher(profile, Number.MAX_SAFE_INTEGER, 0);
  fetcher.beforeRequest = async () => {
    const delay = Math.max(profile.requestIntervalMs || 1000, delayByOrigin.get(homepage.origin) || 0),
      last = lastRequestByOrigin.get(homepage.origin) || 0,
      wait = delay - (Date.now() - last);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestByOrigin.set(homepage.origin, Date.now());
  };
  try {
    const robots = await fetcher.get(homepage.origin + "/robots.txt", "robots");
    result.robotsStatus = robots.status;
    delayByOrigin.set(
      homepage.origin,
      Math.max(profile.requestIntervalMs || 1000, robotsCrawlDelay(robots.html)),
    );
    const sitemaps = robots.html
      .split(/\r?\n/)
      .map((line) => line.split("#")[0].match(/^\s*sitemap\s*:\s*(.*?)\s*$/i)?.[1])
      .filter(Boolean)
      .map((value) => safeSameOrigin(value!, homepage))
      .filter((value): value is string => !!value);
    if (!sitemaps.length)
      for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
        const url = homepage.origin + path;
        if (robotsAllow(robots.html, path)) sitemaps.push(url);
      }
    profile.entryUrls = [...new Set([homepage.toString(), ...sitemaps])];
    if (!robotsAllow(robots.html, homepage.pathname)) {
      result.errors = ["ROBOTS_DENIED_HOMEPAGE"];
      result.requests = fetcher.requests;
      return result;
    }
    const home = await fetcher.get(homepage.toString(), "list");
    result.homepageStatus = home.status;
    if (home.status !== 200) throw Error("HOMEPAGE_NOT_OK");
    const homeCandidates = pageCandidates(home.html, homepage.toString(), homepage),
      sitemapPages: string[] = [],
      sitemapArticles: string[] = [];
    const candidates: RouteCandidate[] = homeCandidates.map(([url, label]) => ({
      url,
      label,
      discoveredFrom: "homepage",
      sampleArticleLinks: null,
      pageStatus: null,
      confirmedListPage: false,
    }));
    const sitemapRoot = sitemaps[0];
    if (sitemapRoot) {
      try {
        const sitemap = await fetcher.get(sitemapRoot, "sitemap");
        if (sitemap.status === 200) {
          const locations = sitemapLocations(sitemap.html, homepage);
          if (/<sitemapindex\b/i.test(sitemap.html)) {
            for (const child of locations.slice(0, 3)) {
              profile.entryUrls = [...new Set([...profile.entryUrls!, child])];
              try {
                const page = await fetcher.get(child, "sitemap");
                if (page.status === 200) {
                  sitemapPages.push(child);
                  sitemapArticles.push(...sitemapLocations(page.html, homepage));
                }
              } catch (error) {
                result.errors = [
                  ...(result.errors as string[]),
                  `SITEMAP_CHILD_${error instanceof Error ? error.message : "FAILED"}`,
                ];
              }
            }
          } else {
            sitemapPages.push(sitemapRoot);
            sitemapArticles.push(...locations);
          }
        }
      } catch (error) {
        result.errors = [
          ...(result.errors as string[]),
          `SITEMAP_${error instanceof Error ? error.message : "FAILED"}`,
        ];
      }
    }
    const articleUrls = sitemapArticles.filter((url) => articleLike(url));
    result.sitemapUrls = sitemapPages;
    result.sitemapArticlePaths = routePrefixes(articleUrls);
    const byUrl = new Map(candidates.map((item) => [item.url, item]));
    const sampleCandidates = candidates
      .sort((a, b) => Number(PATH_HINTS.test(new URL(b.url).pathname)) - Number(PATH_HINTS.test(new URL(a.url).pathname)))
      .slice(0, 5);
    profile.entryUrls = [...new Set([
      ...profile.entryUrls!,
      ...sampleCandidates.map((item) => item.url),
    ])];
    for (const item of sampleCandidates) {
      try {
        const page = await fetcher.get(item.url, "list"),
          detailLinks = pageArticleLinks(page.html, homepage);
        item.pageStatus = page.status;
        item.sampleArticleLinks = detailLinks.length;
        item.confirmedListPage = page.status === 200 && detailLinks.length >= 3;
      } catch (error) {
        item.pageStatus = null;
        result.errors = [
          ...(result.errors as string[]),
          `ENTRY_${error instanceof Error ? error.message : "FAILED"}`,
        ];
      }
    }
    result.candidates = [...byUrl.values()];
  } catch (error) {
    result.errors = [
      ...(result.errors as string[]),
      error instanceof Error ? error.message : "NETWORK_ERROR",
    ];
  }
  result.requests = fetcher.requests;
  return result;
}

for (let offset = 0; offset < sources.length; offset += 4) {
  const results = await Promise.all(sources.slice(offset, offset + 4).map(inspect));
  for (const [index, result] of results.entries()) {
    appendFileSync(outputPath, JSON.stringify(result) + "\n");
    console.log(
      JSON.stringify({
        done: offset + index + 1,
        total: sources.length,
        sourceId: result.sourceId,
        homepageStatus: result.homepageStatus,
        candidates: (result.candidates as RouteCandidate[]).length,
        requests: result.requests,
        errors: result.errors,
      }),
    );
  }
}
