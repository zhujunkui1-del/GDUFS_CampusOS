import { expect, it } from "vitest";
import { contentReadPlan } from "@/lib/server/assistant/read-plan";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import { externalPolicy } from "@/lib/server/external-search/policy";
import {
  KnowledgeSearchInputSchema,
  EventSearchInputSchema,
} from "@/domain/retrieval/skills";

// Every planned read is executed before the model ever sees it, and a schema
// violation fails the call with zero duration — the answer becomes "这次查询
// 未完成" instead of a list. The knowledge tool caps at 4 and events at 6, so
// widening a page for one purpose must not exceed the other's cap.
const plan = (query: string) => {
  const c = contentIntent(query);
  return contentReadPlan(
    c.tools,
    c.query,
    externalPolicy(query),
    () => false,
    c.retrievalQuery,
    () => false,
    c.radarCategory,
    c.recentDiscovery,
  );
};

it.each([
  "院运会",
  "最近有什么讲座",
  "信息学院有没有院运会",
  "还有别的学院的院运会吗",
])("plans only reads that their own schema accepts: %s", (query) => {
  for (const read of plan(query)) {
    const schema =
      read.name === "search_campus_events"
        ? EventSearchInputSchema
        : read.name === "search_campus_knowledge"
          ? KnowledgeSearchInputSchema
          : null;
    if (!schema) continue;
    expect(schema.safeParse(read.input).success, read.name).toBe(true);
  }
});

it("keeps the knowledge page at its own cap", () => {
  const knowledge = plan("院运会").filter(
    (r) => r.name === "search_campus_knowledge",
  );
  expect(knowledge.length).toBeGreaterThan(0);
  for (const read of knowledge)
    expect((read.input as { limit: number }).limit).toBeLessThanOrEqual(4);
});
