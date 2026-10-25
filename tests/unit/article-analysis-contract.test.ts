import { it, expect } from "vitest";
import {
  articleText,
  evidence,
  evidenceValid,
} from "@/lib/ingestion/article-text";
import { ArticleEvidenceSchema } from "@/domain/console/article-analysis";
import {
  TopicTagsSchema,
  radarCategories,
  knowledgeCategories,
} from "@/domain/console/taxonomy";
it("keeps the thirteen business classifications and existing tags, with a defined compatible tag extension", () => {
  expect(radarCategories).toHaveLength(7);
  expect(knowledgeCategories).toHaveLength(6);
  expect(
    TopicTagsSchema.parse(["AI", "校园招聘", "毕业生", "就业服务"]),
  ).toHaveLength(4);
  expect(() => TopicTagsSchema.parse(["任意新标签"])).toThrow();
});
it("projects readable content with stable evidence without changing HTML or executing embedded content", () => {
  const html =
    '<style>假报名截止2026年1月1日</style><p>填写申请。</p><p>提交材料。</p><a href="/apply">报名链接</a><script>alert(1)</script>';
  const text = articleText({
    title: "指南",
    body: html,
    bodyFormat: "reading_html",
    originalUrl: "https://example.invalid/doc",
  });
  expect(text.text).toBe("填写申请。\n提交材料。\n报名链接");
  expect(text.links[0].url).toBe("https://example.invalid/apply");
  expect(evidenceValid(text, evidence(text, "body", 0, 5, "procedure"))).toBe(
    true,
  );
  expect(() =>
    ArticleEvidenceSchema.parse({
      field: "body",
      startOffset: 0,
      endOffset: 8,
      text: "错",
      role: "test",
    }),
  ).toThrow();
  expect(html).toContain("<style>");
});
it("does not turn a metadata placeholder into full-text evidence", () => {
  expect(
    articleText({
      title: "通知",
      body: "仅登记公开元数据，未保存第三方正文。",
      bodyStatus: "not_provided",
    }).bodyAvailable,
  ).toBe(false);
});
