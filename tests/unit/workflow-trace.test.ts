import { it, expect } from "vitest";
import {
  WorkflowTrace,
  observeWorkflowModel,
} from "@/lib/server/assistant/workflow-trace";
import { MockModelProvider } from "../fixtures/mock-model";
it("buffers preparatory spans, streams later spans, and preserves provider failures", async () => {
  const trace = new WorkflowTrace(true);
  const done = trace.start("building", { query: "图书馆" });
  done({ matches: 1 });
  const emitted: unknown[] = [];
  trace.attach((record) => emitted.push(record));
  expect(emitted).toHaveLength(2);
  const error = Error("fixture failure");
  const provider = new MockModelProvider([error]);
  const observed = observeWorkflowModel(provider, trace, "fixture-model");
  await expect(
    observed.generateWithTools({
      messages: [{ role: "system", content: "private prompt not for trace" }],
      tools: [],
      maxTokens: 50,
      signal: new AbortController().signal,
    }),
  ).rejects.toBe(error);
  expect(emitted).toHaveLength(4);
  expect(JSON.stringify(emitted)).not.toContain("private prompt");
  expect(trace.records.at(-1)?.state).toBe("error");
});
it("adds no trace data or replacement client for ordinary chat", () => {
  const trace = new WorkflowTrace(false),
    provider = new MockModelProvider([]);
  trace.start("route", { question: "test" })({ done: true });
  expect(trace.records).toEqual([]);
  expect(observeWorkflowModel(provider, trace, "fixture")).toBe(provider);
});
