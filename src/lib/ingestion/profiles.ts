// A source may configure multiple article columns. Rule changes invalidate the
// source policy and require a fresh administrator review.
import {
  WebProfileConfigSchema,
  type WebProfileConfig,
} from "@/domain/console/web-profile";

export type WebProfile = {
  sourceId: string;
  name: string;
  origin: string;
  configurationStatus?: "discovered" | "verified";
  earliestImportDay?: string;
  latestImportDay?: string;
  entryUrl: string;
  entryUrls?: string[];
  ruleVersion: string;
  titleSelector: string;
  titleSuffix: string;
  dateSelector: string;
  dateLabel: string;
  bodySelector: string;
  detailPath: string;
  detailPathPrefixes?: string[];
  allowQueryUrls?: boolean;
  // A handful of campus sites still serve only plain HTTP because their
  // certificate expired and nobody renewed it. The profile keeps the
  // restriction explicit so every other source stays HTTPS-only.
  allowInsecureHttp?: boolean;
  requestIntervalMs?: number;
};
const ruleVersion = "official-web-2026-10-19.4";
export const webProfiles: WebProfile[] = [
  {
    sourceId: "GDUFS-SRC-0012",
    name: "广东外语外贸大学",
    origin: "https://www.gdufs.edu.cn",
    entryUrl: "https://www.gdufs.edu.cn/xkky/rdjz.htm",
    ruleVersion,
    titleSelector: "head > title",
    titleSuffix: "-广东外语外贸大学",
    dateSelector: "span",
    dateLabel: "发布时间",
    bodySelector: "#vsb_content .v_news_content, .v_news_content",
    detailPath: "^/info/1005/[0-9]+\\.htm$",
    detailPathPrefixes: ["/info/1005/"],
  },
  {
    sourceId: "GDUFS-SRC-0010",
    name: "学生工作部",
    origin: "https://nstu.gdufs.edu.cn",
    entryUrl: "https://nstu.gdufs.edu.cn/index/tzgg.htm",
    ruleVersion,
    titleSelector: "head > title",
    titleSuffix: "-广东外语外贸大学学生工作部",
    dateSelector: ".contenthead p",
    dateLabel: "发布时间",
    bodySelector: "#vsb_content_501 .v_news_content",
    detailPath: "^/info/1056/[0-9]+\\.htm$",
    detailPathPrefixes: ["/info/1056/"],
  },
  {
    sourceId: "GDUFS-SRC-0017",
    name: "总务后勤部",
    origin: "https://hqc.gdufs.edu.cn",
    entryUrl: "https://hqc.gdufs.edu.cn/tzgap.htm",
    ruleVersion,
    titleSelector: "head > title",
    titleSuffix: "-广东外语外贸大学总务后勤部",
    dateSelector: ".wzxxys",
    dateLabel: "时间",
    bodySelector: "#vsb_content_2 .v_news_content",
    detailPath: "^/info/1006/[0-9]+\\.htm$",
    detailPathPrefixes: ["/info/1006/"],
  },
  {
    sourceId: "GDUFS-SRC-0024",
    name: "校团委",
    origin: "https://youth.gdufs.edu.cn",
    entryUrl: "https://youth.gdufs.edu.cn/tzgg.htm",
    ruleVersion,
    titleSelector: "head > title",
    titleSuffix: "-团学时空",
    dateSelector: ".wzxxys",
    dateLabel: "时间",
    bodySelector: "#vsb_content .v_news_content",
    detailPath: "^/info/1050/[0-9]+\\.htm$",
    detailPathPrefixes: ["/info/1050/"],
  },
  {
    sourceId: "GDUFS-SRC-0008",
    name: "图书馆",
    origin: "https://lib.gdufs.edu.cn",
    entryUrl: "https://lib.gdufs.edu.cn/xwzx/bgtg.htm",
    ruleVersion,
    titleSelector: "head > title",
    titleSuffix: "-广东外语外贸大学图书馆",
    dateSelector: ".viewInfo1",
    dateLabel: "时间",
    bodySelector: "#vsb_content .v_news_content",
    detailPath: "^/info/1134/[0-9]+\\.htm$",
    detailPathPrefixes: ["/info/1134/"],
  },
];
export function profileFor(sourceId: string) {
  const p = webProfiles.find((x) => x.sourceId === sourceId);
  if (!p) throw Error("UNAPPROVED_SOURCE");
  return p;
}
export function profileFromSource(input: {
  sourceId: string;
  name: string;
  websiteUrl: string | null;
  webProfileJson?: string | null;
}) {
  const raw = input.webProfileJson;
  if (raw && raw !== "{}") {
    const config: WebProfileConfig = WebProfileConfigSchema.parse(
      JSON.parse(raw),
    );
    const homepage = input.websiteUrl ? new URL(input.websiteUrl) : null;
    if (!homepage || !["https:", "http:"].includes(homepage.protocol))
      throw Error("PROFILE_ORIGIN_REQUIRED");
    const origin = homepage.origin,
      // An expired certificate leaves the site on plain HTTP only; carry the
      // exception through the profile so approvedUrl() can stay strict for
      // every other source.
      allowInsecureHttp = homepage.protocol === "http:";
    if (
      config.entryUrls.some((value) => {
        const entry = new URL(value);
        return (
          entry.host !== homepage.host ||
          entry.protocol !== homepage.protocol ||
          !!entry.username ||
          !!entry.password ||
          !!entry.port ||
          (!!entry.search && !config.allowQueryUrls) ||
          !!entry.hash
        );
      })
    )
      throw Error("PROFILE_ENTRY_ORIGIN_MISMATCH");
    return {
      sourceId: input.sourceId,
      name: input.name,
      origin,
      configurationStatus: config.configurationStatus,
      earliestImportDay: config.earliestImportDay,
      latestImportDay: config.latestImportDay,
      entryUrl: config.entryUrls[0],
      entryUrls: config.entryUrls,
      ruleVersion: config.ruleVersion,
      titleSelector: config.titleSelector,
      titleSuffix: config.titleSuffix,
      dateSelector: config.dateSelector,
      dateLabel: config.dateLabel,
      bodySelector: config.bodySelector,
      detailPath: "",
      detailPathPrefixes: config.articlePathPrefixes,
      allowQueryUrls: config.allowQueryUrls,
      allowInsecureHttp,
      requestIntervalMs: config.requestIntervalMs,
    } satisfies WebProfile;
  }
  const existing = webProfiles.find(
    (profile) => profile.sourceId === input.sourceId,
  );
  return existing &&
    input.websiteUrl &&
    new URL(input.websiteUrl).origin === existing.origin
    ? { ...existing, name: input.name, entryUrls: [existing.entryUrl] }
    : null;
}
export function approvedUrl(
  p: WebProfile,
  raw: string,
  kind: "robots" | "sitemap" | "list" | "detail" | "attachment" = "detail",
) {
  const u = new URL(raw, p.entryUrl);
  u.hash = "";
  const origin = new URL(p.origin),
    // A plain-HTTP profile stays on its own scheme: HTTPS there is a different
    // certificate, which is exactly what broke.
    schemeOk = p.allowInsecureHttp
      ? u.protocol === "http:"
      : u.protocol === "https:";
  if (
    u.host !== origin.host ||
    !schemeOk ||
    u.username ||
    u.password ||
    [...u.searchParams.keys()].some((key) =>
      /^(uin|key|pass_ticket|appmsg_token|token|code)$/i.test(key),
    ) ||
    (u.search &&
      !p.allowQueryUrls &&
      !(p.entryUrls || [p.entryUrl]).some((entryUrl) => {
        const entry = new URL(entryUrl);
        return entry.pathname === u.pathname && entry.search === u.search;
      })) ||
    u.port
  )
    throw Error("URL_NOT_ALLOWED");
  const allowed =
    kind === "robots"
      ? u.pathname === "/robots.txt"
      : kind === "sitemap"
        ? (p.entryUrls || [p.entryUrl]).some((entryUrl) => {
            const entry = new URL(entryUrl);
            return entry.pathname === u.pathname && entry.search === u.search;
          })
        : kind === "list"
          ? (p.entryUrls || [p.entryUrl]).some((entryUrl) => {
              const path = new URL(entryUrl).pathname;
              return (
                u.pathname === path ||
                (u.pathname.startsWith(path.replace(/\.htm$/, "/")) &&
                  /\/[0-9]+\.htm$/.test(u.pathname))
              );
            })
          : kind === "detail"
            ? p.detailPathPrefixes?.some(
                (prefix) =>
                  u.pathname.startsWith(prefix) &&
                  (!p.detailPath || new RegExp(p.detailPath).test(u.pathname)),
              ) ||
              (!!p.detailPath && new RegExp(p.detailPath).test(u.pathname))
            : /\.(pdf|docx?|xlsx?|zip)$/i.test(u.pathname);
  if (!allowed) throw Error("URL_NOT_ALLOWED");
  return u.toString();
}
