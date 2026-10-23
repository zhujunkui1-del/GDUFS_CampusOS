import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const routeFile = "docs/官网栏目入口发现-2026-10-23.md",
  sampleFile = "docs/官网文章路径抽样-2026-10-23.md",
  followupFile =
    "test-results/official-web-list-samples-followup-2026-10-23.jsonl",
  outputFile =
    "docs/verification/official-web-collection-preview/candidate-profiles.json",
  routeText = readFileSync(routeFile, "utf8"),
  sampleText = readFileSync(sampleFile, "utf8"),
  sourcePattern = /^### (GDUFS-SRC-\d+) · (.+)$/gm,
  sources = new Map(),
  samples = new Map();

for (const match of routeText.matchAll(sourcePattern)) {
  const start = match.index + match[0].length,
    next = routeText.indexOf("\n### GDUFS-SRC-", start),
    block = routeText.slice(start, next < 0 ? undefined : next),
    home = block.match(/^- 官网首页：\[[^\]]*\]\((https?:\/\/[^)]+)\)/m),
    confirmed = [],
    lines = block.split(/\r?\n/);
  let inConfirmed = false;
  for (const line of lines) {
    if (/^- 列表页候选（已观察到文章样式链接）：/.test(line)) {
      inConfirmed = true;
      continue;
    }
    if (/^- 其他栏目候选/.test(line)) inConfirmed = false;
    if (!inConfirmed) continue;
    const candidate = line.match(
      /^\s+- \[([^\]]*)\]\((https?:\/\/[^)]+)\) · (\d+) 个文章样式链接$/,
    );
    if (candidate)
      confirmed.push({
        label: candidate[1].trim(),
        url: candidate[2].trim(),
        observedArticleLinks: Number(candidate[3]),
      });
  }
  sources.set(match[1], {
    sourceId: match[1],
    name: match[2].trim(),
    websiteUrl: home?.[1] || null,
    confirmed,
  });
}

for (const match of sampleText.matchAll(/^## (GDUFS-SRC-\d+) · (.+)$/gm)) {
  const start = match.index + match[0].length,
    next = sampleText.indexOf("\n## GDUFS-SRC-", start),
    block = sampleText.slice(start, next < 0 ? undefined : next),
    candidatePattern = /^### \[([^\]]*)\]\((https?:\/\/[^)]+)\)\s*$/gm,
    sourceSamples = new Map();
  for (const candidate of block.matchAll(candidatePattern)) {
    const candidateStart = candidate.index + candidate[0].length,
      candidateEnd = block.indexOf("\n### ", candidateStart),
      candidateBlock = block.slice(
        candidateStart,
        candidateEnd < 0 ? undefined : candidateEnd,
      ),
      count = Number(candidateBlock.match(/文章链接样本：\s*(\d+)/)?.[1] || 0),
      status = Number(candidateBlock.match(/列表页状态：\s*(\d+)/)?.[1] || 0),
      prefixes = [
        ...candidateBlock.matchAll(/`(\/[^`?#]+)`（样本(\d+)）/g),
      ].map((prefix) => ({ path: prefix[1], samples: Number(prefix[2]) }));
    sourceSamples.set(candidate[2].trim(), {
      label: candidate[1].trim(),
      url: candidate[2].trim(),
      status,
      articleLinkSamples: count,
      prefixes,
    });
  }
  samples.set(match[1], sourceSamples);
}

try {
  const followupRows = readFileSync(followupFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  for (const row of followupRows) {
    const source = sources.get(row.sourceId);
    if (!source) continue;
    const sourceSamples = samples.get(row.sourceId) || new Map();
    for (const candidate of row.candidates || []) {
      const prefixes = (candidate.articlePathPrefixes || []).map((item) => ({
          path: item.prefix,
          samples: item.samples,
        })),
        linkCount = (candidate.articleLinks || []).length;
      sourceSamples.set(candidate.url, {
        label: candidate.label,
        url: candidate.url,
        status: candidate.status,
        articleLinkSamples: linkCount,
        prefixes,
      });
      if (
        candidate.status === 200 &&
        linkCount >= 3 &&
        !source.confirmed.some((item) => item.url === candidate.url)
      )
        source.confirmed.push({
          label: candidate.label,
          url: candidate.url,
          observedArticleLinks: linkCount,
        });
    }
    samples.set(row.sourceId, sourceSamples);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const profiles = [],
  excluded = [];
for (const source of sources.values()) {
  if (!source.confirmed.length) {
    excluded.push({
      sourceId: source.sourceId,
      reason: "no_confirmed_list_page",
    });
    continue;
  }
  if (!source.websiteUrl) {
    excluded.push({ sourceId: source.sourceId, reason: "missing_homepage" });
    continue;
  }
  const homepage = new URL(source.websiteUrl),
    sampleByUrl = samples.get(source.sourceId) || new Map(),
    entries = [],
    prefixCounts = new Map(),
    rejected = [];
  for (const candidate of source.confirmed) {
    const parsed = new URL(candidate.url),
      sample = sampleByUrl.get(candidate.url);
    if (
      homepage.protocol !== "https:" ||
      parsed.protocol !== "https:" ||
      parsed.origin !== homepage.origin ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      rejected.push({ url: candidate.url, reason: "not_same_origin_https" });
      continue;
    }
    if (!sample || sample.status !== 200 || sample.articleLinkSamples < 3) {
      rejected.push({
        url: candidate.url,
        reason: "no_successful_article_path_sample",
      });
      continue;
    }
    const validPrefixes = sample.prefixes.filter(
      (prefix) =>
        prefix.samples >= 1 &&
        prefix.path.startsWith("/") &&
        !prefix.path.startsWith("//") &&
        prefix.path.length > 1,
    );
    if (!validPrefixes.length) {
      rejected.push({ url: candidate.url, reason: "no_repeated_detail_path" });
      continue;
    }
    entries.push(candidate);
    for (const prefix of validPrefixes)
      prefixCounts.set(
        prefix.path,
        Math.max(prefix.samples, prefixCounts.get(prefix.path) || 0),
      );
  }
  const entryUrls = [...new Set(entries.map((item) => item.url))],
    articlePathPrefixes = [...prefixCounts.keys()];
  if (!entryUrls.length || !articlePathPrefixes.length) {
    excluded.push({
      sourceId: source.sourceId,
      reason: "no_compatible_profile_paths",
      rejected,
    });
    continue;
  }
  profiles.push({
    sourceId: source.sourceId,
    name: source.name,
    websiteUrl: source.websiteUrl,
    entryUrls,
    articlePathPrefixes,
    allowQueryUrls: entryUrls.some((url) => new URL(url).search.length > 0),
    evidence: {
      entryCount: entryUrls.length,
      sampledPathCount: articlePathPrefixes.length,
      observedListLinks: entries.reduce(
        (sum, item) => sum + item.observedArticleLinks,
        0,
      ),
      rejected,
    },
  });
}

const manifest = {
  generatedAt: new Date().toISOString(),
  sourceCount: sources.size,
  profileCount: profiles.length,
  entryPageCount: profiles.reduce(
    (sum, profile) => sum + profile.entryUrls.length,
    0,
  ),
  detailPathPrefixCount: profiles.reduce(
    (sum, profile) => sum + profile.articlePathPrefixes.length,
    0,
  ),
  profiles,
  excluded,
};
mkdirSync("docs/verification/official-web-collection-preview", {
  recursive: true,
});
writeFileSync(outputFile, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    output: outputFile,
    sourceCount: manifest.sourceCount,
    profileCount: manifest.profileCount,
    entryPageCount: manifest.entryPageCount,
    detailPathPrefixCount: manifest.detailPathPrefixCount,
    excluded: excluded.length,
  }),
);
