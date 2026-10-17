// Audited public columns only. Changes require a new ruleVersion and policy review.
export type WebProfile = {
  sourceId: string;
  name: string;
  origin: string;
  entryUrl: string;
  ruleVersion: string;
  titleSelector: string;
  titleSuffix: string;
  dateSelector: string;
  dateLabel: string;
  bodySelector: string;
  detailPath: string;
};
const ruleVersion = "official-web-2026-10-17.1";
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
  },
];
export function profileFor(sourceId: string) {
  const p = webProfiles.find((x) => x.sourceId === sourceId);
  if (!p) throw Error("UNAPPROVED_SOURCE");
  return p;
}
export function approvedUrl(
  p: WebProfile,
  raw: string,
  kind: "robots" | "list" | "detail" | "attachment" = "detail",
) {
  const u = new URL(raw, p.entryUrl);
  u.hash = "";
  if (
    u.origin !== p.origin ||
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.port
  )
    throw Error("URL_NOT_ALLOWED");
  const entry = new URL(p.entryUrl).pathname;
  const allowed =
    kind === "robots"
      ? u.pathname === "/robots.txt"
      : kind === "list"
        ? u.pathname === entry ||
          (u.pathname.startsWith(entry.replace(/\.htm$/, "/")) &&
            /\/[0-9]+\.htm$/.test(u.pathname))
        : kind === "detail"
          ? new RegExp(p.detailPath).test(u.pathname)
          : /\.(pdf|docx?|xlsx?|zip)$/i.test(u.pathname);
  if (!allowed) throw Error("URL_NOT_ALLOWED");
  return u.toString();
}
