import { it, expect } from "vitest";
import { normalizeCitations, citedAnswer } from "@/lib/server/assistant/citations";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";

const card = (id: string): AssistantCard => ({
  kind: "source",
  documentId: id,
  title: id,
  sourceName: "官网",
  originalUrl: "https://example.test/" + id,
  publishedAt: "2026-10-01",
  snippet: "正文",
  evidenceType: "full_text",
  classificationState: "unknown",
  validity: "unknown",
  readable: true,
});

it("normalises the internal [nN] marker the model sometimes emits", () => {
  expect(normalizeCitations("开放时间见公告[n1][n2]。")).toBe(
    "开放时间见公告[1][2]。",
  );
});

it("keeps the source card when the marker was written as [n1]", () => {
  const cards = [card("a"), card("b")];
  const { text, cards: kept } = citedAnswer("食堂[n1]和二饭[n2]。", cards);
  expect(text).toBe("食堂[1]和二饭[2]。");
  expect(kept).toHaveLength(2);
});

it("drops unused sources and renumbers", () => {
  const cards = [card("a"), card("b"), card("c")];
  const { text, cards: kept } = citedAnswer("只用到第三条[来源3]。", cards);
  expect(text).toBe("只用到第三条[1]。");
  expect(kept.map((c) => c.kind === "source" && c.documentId)).toEqual(["c"]);
});
