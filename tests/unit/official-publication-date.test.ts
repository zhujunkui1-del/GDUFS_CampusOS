import { it, expect } from "vitest";
import { OfficialWebConnector } from "@/lib/ingestion/connector";
import { webProfiles } from "@/lib/ingestion/profiles";

it("reads the labeled CMS publication header without taking dates from article text", () => {
  const profile = {
    ...webProfiles[0],
    titleSelector: "h1",
    titleSuffix: "",
    bodySelector: "article",
    dateSelector: ".configured-date",
    dateLabel: "发布时间",
  };
  const connector = new OfficialWebConnector(profile),
    url = profile.origin + profile.detailPathPrefixes![0] + "999555.htm";
  const html = (header: string) =>
    `<html><body><h1>原文通知</h1>${header}<article><p>活动于2026年05月12日举办。</p></article></body></html>`;
  const parsed = connector.parse(
    html(
      '<div class="other-s">发布日期：2026年04月03日 09:34&nbsp;作者：学校</div>',
    ),
    url,
  );
  expect(parsed.dateText).toBe("2026年04月03日 09:34");
  expect(
    connector.normalize(parsed, url, "licensed_full_text").publishedAt,
  ).toBe("2026-04-03T01:34:00.000Z");
  expect(connector.parse(html(""), url).dateText).toBe("");
  expect(
    connector.parse(
      html(
        '<div class="other-s">发布日期：2026年04月03日</div><div class="other-s">发布日期：2026年04月04日</div>',
      ),
      url,
    ).dateText,
  ).toBe("");
  expect(
    connector.parse(
      html(
        '<div class="configured-date">发布时间：2026年04月05日</div><div class="other-s">发布日期：2026年04月03日</div>',
      ),
      url,
    ).dateText,
  ).toBe("2026年04月05日");
});

it("reads a list stamp that splits the month/day from the year", () => {
  const profile = {
    ...webProfiles[0],
    origin: "https://tyb.gdufs.edu.cn",
    entryUrl: "https://tyb.gdufs.edu.cn/tzgg.htm",
    entryUrls: ["https://tyb.gdufs.edu.cn/tzgg.htm"],
    detailPath: "^/info/1032/[0-9]+\.htm$",
    detailPathPrefixes: ["/info/1032/"],
  };
  const connector = new OfficialWebConnector(profile);
  const html = `<html><body><ul>
    <li><a href="/info/1032/2978.htm"><div class="text-ldata"><div><p>10/26</p><span>2026</span></div></div><div class="text-linfo">关于举办比赛的通知</div></a></li>
  </ul></body></html>`;
  const found = connector.discover(html, profile.entryUrl);
  expect(found.dates[0]?.publishedAt).toBe("2026-10-26");
});

it("accepts a space between the date label and its colon", () => {
  const profile = {
    ...webProfiles[0],
    titleSelector: "h1",
    titleSuffix: "",
    bodySelector: "div.v_news_content",
    dateSelector: ".page-date",
    dateLabel: "发布时间",
  };
  const connector = new OfficialWebConnector(profile),
    url = profile.origin + profile.detailPathPrefixes![0] + "10279.htm";
  const html = `<html><body><h1>讲座预告</h1><div class="page-date">发布时间 : 2026-10-27 浏览次数：12</div><div class="v_news_content"><p>正文内容。</p></div></body></html>`;
  expect(connector.parse(html, url).publishedAt).toBe("2026-10-27");
});

it("drops the site banner from a title that fell back to <title>", () => {
  const profile = {
    ...webProfiles[0],
    titleSelector: "title",
    titleSuffix: "",
    bodySelector: "div.v_news_content",
    dateSelector: ".page-date",
    dateLabel: "发布时间",
  };
  const connector = new OfficialWebConnector(profile),
    url = profile.origin + profile.detailPathPrefixes![0] + "10279.htm";
  const html = `<html><head><title>我校男女足在联赛中斩获佳绩-广东外语外贸大学新闻中心</title></head><body><div class="page-date">发布时间：2026-10-20</div><div class="v_news_content"><p>正文内容。</p></div></body></html>`;
  expect(connector.parse(html, url).title).toBe("我校男女足在联赛中斩获佳绩");
});

it("reads the headline from the pageTitle meta when the banner is appended", () => {
  const profile = {
    ...webProfiles[0],
    titleSelector: "title",
    titleSuffix: "",
    bodySelector: "div.v_news_content",
    dateSelector: ".page-date",
    dateLabel: "发布时间",
  };
  const connector = new OfficialWebConnector(profile),
    url = profile.origin + profile.detailPathPrefixes![0] + "10279.htm";
  const html = `<html><head><meta name="pageTitle" content="喜报！我院项目入选省级试点名单"><title>喜报！我院项目入选省级试点名单-创新创业学院</title></head><body><div class="page-date">发布时间：2026-10-20</div><div class="v_news_content"><p>正文内容。</p></div></body></html>`;
  expect(connector.parse(html, url).title).toBe("喜报！我院项目入选省级试点名单");
});

it("falls back to the page title when the configured selector matches nothing", () => {
  const profile = {
    ...webProfiles[0],
    titleSelector: ".missing-heading",
    titleSuffix: "",
    bodySelector: "div.v_news_content",
    dateSelector: ".page-date",
    dateLabel: "发布时间",
  };
  const connector = new OfficialWebConnector(profile),
    url = profile.origin + profile.detailPathPrefixes![0] + "10279.htm";
  const html = `<html><head><title>基础建设部2025年度职称推荐评审公示-广东外语外贸大学</title></head><body><div class="page-date">发布时间：2026-10-20</div><div class="v_news_content"><p>正文内容。</p></div></body></html>`;
  expect(connector.parse(html, url).title).toBe("基础建设部2025年度职称推荐评审公示");
});
