import { expect, it } from "vitest";
import {
  ASSISTANT_WELCOME,
  ASSISTANT_WELCOME_EXAMPLES,
} from "@/lib/assistant/welcome";

// The opening line is the only place that tells a first-time reader what the
// assistant can do. It may only promise tools this deployment actually ships.
it("describes what the assistant can reach without over-promising", () => {
  expect(ASSISTANT_WELCOME).toContain("校园雷达");
  expect(ASSISTANT_WELCOME).toContain("校园知识");
  expect(ASSISTANT_WELCOME).toContain("结合原文");
  expect(ASSISTANT_WELCOME).not.toMatch(/全网|搜索引擎|离线数据库/);
});

it("offers the examples it quotes as one-click prompts", () => {
  for (const example of ASSISTANT_WELCOME_EXAMPLES) {
    expect(ASSISTANT_WELCOME).toContain(`「${example}」`);
  }
  expect(new Set(ASSISTANT_WELCOME_EXAMPLES).size).toBe(
    ASSISTANT_WELCOME_EXAMPLES.length,
  );
});
