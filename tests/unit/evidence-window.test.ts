import { it, expect } from "vitest";
import { evidenceWindow } from "@/lib/retrieval/evidence-window";
it("selects actual procedural sentences after the introductory questions without adding a model call", () => {
  const text =
    "图书馆：你怎么还不来？如何借书？自助借还怎么操作？\n" +
    "欢迎了解图书馆的各项服务。\n".repeat(90) +
    "第一步：持本人校园卡，在自助借还机选择借书，扫描图书条码并确认。\n第二步：请核对借阅记录。";
  const w = evidenceWindow(text, "广外图书馆怎么借书", 700);
  expect(w.text).toContain("第一步");
  expect(w.text).toContain("扫描图书条码");
  expect(w.text.length).toBeLessThanOrEqual(700);
  expect(text.slice(w.start, w.start + w.text.length)).toBe(w.text);
});
it("keeps registration cutoffs separate from event and work-submission dates", () => {
  const text =
    "发布日期：2026年10月1日。\n" +
    "活动介绍与背景。\n".repeat(80) +
    "讲座时间：2026年11月5日。\n报名截止：2026年11月3日17:00。\n" +
    "其他说明。".repeat(100) +
    "作品提交截止：2026年11月10日。";
  expect(evidenceWindow(text, "讲座报名截止时间", 250).text).toContain(
    "报名截止：2026年11月3日17:00",
  );
});
