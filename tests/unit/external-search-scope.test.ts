import { describe, expect, it } from "vitest";
import {
  externalScope,
  isCampusQuestion,
  splitEnumeration,
} from "@/lib/server/external-search/scope";

describe("external search scope", () => {
  it("keeps the university's own questions on campus", () => {
    for (const question of [
      "广外一饭有什么好吃的？",
      "学术交流中心最近两周有什么活动？",
      "图书馆借阅规则是什么？",
      "最近有什么讲座？",
      "学生证丢了怎么补办？",
      "这周有哪些比赛？",
      "挑战杯比赛什么时候举办？",
      "南校区的宿舍环境怎么样？",
    ])
      expect(externalScope(question), question).toBe("campus");
  });

  it("treats a question about the world as general", () => {
    for (const question of [
      "Cloudflare、D1、SQLite 分别是什么？",
      "Python 最新正式稳定版本是什么？",
      "OpenAI 和 DeepSeek 的 API 定价分别是多少？",
      "最近三个月 AI Agent 方向有哪些论文？",
      "欧盟 AI 法案已经全面禁止所有开源模型吗？",
      "1+8*9-7 等于多少？",
    ])
      expect(externalScope(question), question).toBe("general");
  });

  it("lets a named global subject override a campus word", () => {
    expect(isCampusQuestion("OpenAI 的 API 定价和校园卡有什么关系")).toBe(
      false,
    );
    expect(isCampusQuestion("广外的图书馆借阅规则")).toBe(true);
  });
});

describe("enumeration splitting", () => {
  it("splits a comma-separated list of names", () => {
    expect(splitEnumeration("Cloudflare、D1、SQLite 分别是什么？")).toEqual([
      "Cloudflare",
      "D1",
      "SQLite",
    ]);
  });

  it("splits two Latin names joined by 和 and keeps the shared predicate", () => {
    expect(
      splitEnumeration("OpenAI 和 DeepSeek 的 API 定价分别是多少"),
    ).toEqual(["OpenAI 的 API 定价", "DeepSeek 的 API 定价"]);
  });

  it("leaves ordinary questions alone", () => {
    for (const question of [
      "广外一饭有什么好吃的？",
      "图书馆借阅规则是什么？",
      "最近有什么讲座？",
      "这周有哪些比赛？",
      "Python 最新正式稳定版本是什么？",
      "1+8*9-7 等于多少？",
    ])
      expect(splitEnumeration(question), question).toEqual([]);
  });

  it("does not split a list of clauses", () => {
    expect(splitEnumeration("学生证丢了，怎么补办？")).toEqual([]);
  });
});
