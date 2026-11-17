import { it, expect } from "vitest";
import { resolvePersonalConflict } from "@/lib/server/assistant/personal-conflicts";
import { personalRead } from "@/lib/server/assistant/personal-reads";
import { dateGateFixture } from "../fixtures/date-gate";

it("continues personal conflicts for scope and date replies and switches for explicit new subjects", () => {
  const initial = resolvePersonalConflict("我的代办事项中有什么冲突的活动吗")!;
  expect(initial).toMatchObject({ scope: "all", dataSource: "personal_todos" });
  expect(resolvePersonalConflict("待办有哪些冲突的活动")).toMatchObject({
    scope: "all",
    dataSource: "personal_todos",
  });
  expect(resolvePersonalConflict("我所有待办有冲突吗")).toMatchObject({
    scope: "all",
    dataSource: "personal_todos",
  });
  for (const reply of ["所有活动", "全部", "所有事项", "全部待办"])
    expect(resolvePersonalConflict(reply, initial)).toMatchObject({
      scope: "all",
      dataSource: "personal_todos",
    });
  expect(
    resolvePersonalConflict("只看11月20号", initial, Date.parse("2026-11-17")),
  ).toMatchObject({ date: "2026-11-20" });
  expect(resolvePersonalConflict("就这两个", initial)).toMatchObject({
    status: "awaiting_clarification",
  });
  expect(
    resolvePersonalConflict("广外最近有什么活动", initial),
  ).toBeUndefined();
  expect(resolvePersonalConflict("奖学金制度", initial)).toBeUndefined();
  expect(resolvePersonalConflict("所有活动")).toBeUndefined();
});

it("distinguishes unauthenticated and empty task reads without using a deadline as an interval", async () => {
  const f = await dateGateFixture();
  try {
    const question = "我的待办有哪些冲突的活动";
    const guest = await personalRead(f.db, undefined, question);
    expect(guest?.diagnostics).toMatchObject({
      readStatus: "unauthenticated",
      retrievalStatus: "not_executed",
      taskStatus: "needs_auth",
    });
    const empty = await personalRead(f.db, "empty-fixture", question);
    expect(empty?.diagnostics).toMatchObject({
      readStatus: "completed",
      retrievalStatus: "empty",
      completionReason: "no_unfinished_tasks",
    });
    expect(empty?.text).toContain("没有未完成的待办");
  } finally {
    f.close();
  }
});
