import { describe, it, expect } from "vitest";
import { classifyArticleContent } from "@/lib/ingestion/article-intent";
import { articleText, evidenceValid } from "@/lib/ingestion/article-text";
import { articleIntentCases } from "../fixtures/article-intent-cases";
describe("content intent, thirteen existing business categories and evidence", () => {
  for (const [title, body, destination, category] of articleIntentCases)
    it(title, () => {
      const input = { title, body };
      const result = classifyArticleContent(input);
      expect(result.primaryDestination).toBe(destination);
      expect(result.radarCategory || result.knowledgeCategory).toBe(category);
      for (const e of result.classificationEvidence)
        expect(evidenceValid(articleText(input), e)).toBe(true);
    });
  it("does not assign a destination from source identity or turn a publication date into validity", () => {
    const [title, body] = articleIntentCases[5];
    const a = classifyArticleContent({
        title,
        body,
        sourceId: "website",
        sourceName: "图书馆",
        publishedAt: "2026-10-25",
      }),
      b = classifyArticleContent({
        title,
        body,
        sourceId: "wechat",
        sourceName: "公众号",
        publishedAt: "2025-01-01",
      });
    expect(a.primaryDestination).toBe(b.primaryDestination);
    expect(a.knowledge.validity).toBe("unknown");
  });
  it("keeps mixed content unique and topics distinct from categories", () => {
    const [title, body] = articleIntentCases[10];
    const a = classifyArticleContent({ title, body });
    expect(a.temporalType).toBe("mixed");
    expect(a.auxiliaryDestinations).toEqual(["knowledge"]);
    expect(a.tags).toContain("奖学金");
    expect(a.knowledgeCategory).toBeNull();
  });
  it("does not use metadata placeholders as full text or default unrecognized articles to notices", () => {
    expect(
      classifyArticleContent({
        title: "通知",
        body: "仅登记元数据",
        bodyStatus: "not_provided",
      }).primaryDestination,
    ).toBe("unknown");
    expect(
      classifyArticleContent({ title: "随想", body: "天空很蓝" }).radarCategory,
    ).toBeNull();
  });
});
