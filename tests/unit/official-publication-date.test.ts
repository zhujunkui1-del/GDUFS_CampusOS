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
