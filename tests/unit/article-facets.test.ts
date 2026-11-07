import { describe, expect, it } from "vitest";
import { analyzeArticle } from "@/lib/ingestion/article-analysis";
import {
  detectCollege,
  detectEventType,
} from "@/lib/ingestion/article-college";
import { articleText } from "@/lib/ingestion/article-text";

const input = (title: string, body: string) => ({
  title,
  body,
  sourceName: "测试来源",
  publishedAt: "2026-10-20T00:00:00.000Z",
});

describe("article facets", () => {
  it("recognises the same college however it is spelled", () => {
    const short = detectCollege(articleText(input("院运会", "")), []);
    const full = detectCollege(
      articleText(input("信息科学与技术学院2026年院运会报名通知", "")),
      [],
    );
    expect(full?.id).toBe("informatics");
    expect(full?.name).toBe("信息科学与技术学院");
    // The title is the authority, so it wins over anything in the body.
    expect(short).toBeNull();
  });

  it("prefers the title over a co-organiser named in the body", () => {
    const body = "主办单位：金融学院\n协办公管学院：社会与公共管理学院";
    const hit = detectCollege(
      articleText(input("会计学院第十二届院运会报名通知", body)),
      [],
    );
    expect(hit?.id).toBe("accounting");
    expect(hit?.field).toBe("title");
  });

  it("falls back to the organiser field when the title is silent", () => {
    const hit = detectCollege(
      articleText(input("院运会报名通知", "主办单位：金融学院")),
      ["金融学院"],
    );
    expect(hit?.id).toBe("finance");
  });

  it("classifies an activity kind from its own vocabulary", () => {
    const text = (title: string) =>
      detectEventType(articleText(input(title, "")));
    expect(text("信息科学与技术学院2026年第二十届院运会")).toBe("sports");
    expect(text("学术讲座：人工智能前沿")).toBe("lecture");
    expect(text("英语演讲比赛决赛")).toBe("competition");
    expect(text("校园无偿献血")).toBeNull();
  });

  it("derives the event dates from the extracted activities", () => {
    const a = analyzeArticle(
      input(
        "信息科学与技术学院2026年第二十届院运会报名通知",
        [
          "✅ 比赛时间：2026年11月7日",
          "✅ 比赛地点：假草场",
          "✅ 报名截止：2026年10月20日",
        ].join("\n"),
      ),
    );
    expect(a.college).toBe("informatics");
    expect(a.eventType).toBe("sports");
    expect(a.eventStart).toBe("2026-11-07");
  });

  it("leaves every facet null when the article says nothing", () => {
    const a = analyzeArticle(input("随想", "天空很蓝，云很白。"));
    expect(a.college).toBeNull();
    expect(a.eventType).toBeNull();
    expect(a.eventStart).toBeNull();
    expect(a.eventEnd).toBeNull();
  });
});
