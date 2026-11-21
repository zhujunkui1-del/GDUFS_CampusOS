import { describe, expect, it } from "vitest";
import {
  GROUNDING_GAP_ANSWER,
  pruneUnsupported,
} from "@/lib/server/assistant/grounding-prune";

describe("grounding prune", () => {
  it("drops the sentence carrying an unsupported threshold and keeps the rest", () => {
    const answer =
      "图书借阅期限为30天 [1]。\n本科生需完成“新生闯馆”答题60分以上才能借阅 [4]。\n续借可在到期前通过公众号办理 [2]。";
    const text = pruneUnsupported(answer, [
      "新生需完成“新生闯馆”答题60分以上才解锁借阅权限，资料未提及",
      "引用编号[1][2][3][4]与资料编号1、2、3不对应",
    ]);
    expect(text).toContain("30天");
    expect(text).toContain("续借");
    expect(text).not.toContain("60分");
    expect(text).not.toContain("新生闯馆");
  });

  it("leaves the answer alone when the only issue is citation numbering", () => {
    const answer = "借阅期限为30天 [1]。";
    expect(
      pruneUnsupported(answer, [
        "引用编号[1][2][3][4]与资料编号1、2、3不对应，归属混乱",
      ]),
    ).toBe(answer);
  });

  it("returns an honest gap when every substantive sentence is unsupported", () => {
    const answer =
      "本科生需完成“新生闯馆”答题60分以上才能借阅。\n毕业班约6月10日前还清图书。";
    expect(
      pruneUnsupported(answer, [
        "新生需完成“新生闯馆”答题60分以上才解锁借阅权限，资料未提及",
        "毕业班约6月10日前还清图书，资料未提及",
      ]),
    ).toBe(GROUNDING_GAP_ANSWER);
  });
});
