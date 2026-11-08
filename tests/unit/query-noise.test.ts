import { describe, expect, it } from "vitest";
import { buildQueryPlan, queryRelevance } from "@/lib/retrieval/query-plan";
import { ftsExpression } from "@/lib/retrieval/terms";
import { explicitWebRequest } from "@/lib/server/external-search/policy";

describe("question-shaped modifiers", () => {
  it("does not keep the question glued onto the noun", () => {
    // These fragments contained the interrogative, so no article could ever
    // contain them and every candidate was rejected.
    for (const query of [
      "绩点怎么算的，多少分算优秀？",
      "选课系统什么时候开，大一要选哪些课？",
      "必修课和选修课的学分要求各是多少？",
      "助学金困难认定流程是什么？",
    ])
      for (const modifier of buildQueryPlan(query).modifiers)
        expect(modifier.original).not.toMatch(/什么|哪些|多少|怎么|如何|时候/);
  });

  it("keeps a real subject that merely looks like a question", () => {
    expect(
      buildQueryPlan("校医院看病要预约吗？").modifiers.map((m) => m.original),
    ).toEqual(["校医院看病要预约"]);
  });
});

describe("a modifier is a hint, not a veto", () => {
  it("accepts a document that shares one of several subjects", () => {
    // "平时作业占成绩比例" is asked of a course; the article only has to be
    // about the course, not about every word of the question.
    expect(
      queryRelevance(buildQueryPlan("平时作业占成绩多少比例？"), {
        title: "课程考核办法",
        contentSnippet: "平时作业占成绩的百分之三十。",
      }).relevant,
    ).toBe(true);
  });

  it("still rejects a document that shares none of them", () => {
    expect(
      queryRelevance(buildQueryPlan("辅修和双学位有什么区别？"), {
        title: "深度学习与机器学习",
        contentSnippet: "深度学习是机器学习的子集。",
      }).relevant,
    ).toBe(false);
  });

  it("still requires every named college, so a college question stays narrow", () => {
    expect(
      queryRelevance(buildQueryPlan("信息学院院运会"), {
        title: "英语教育学院院运会",
        contentSnippet: "英语教育学院第二十一届院运会。",
      }).relevant,
    ).toBe(false);
  });

  it("still requires a number or a code, so editions do not collapse", () => {
    expect(
      queryRelevance(buildQueryPlan("云山学术沙龙414期"), {
        title: "云山学术沙龙412期",
      }).relevant,
    ).toBe(false);
    expect(
      queryRelevance(buildQueryPlan("云山学术沙龙414期"), {
        title: "云山学术沙龙414期",
      }).relevant,
    ).toBe(true);
  });

  it("widens the FTS recall to match the gate", () => {
    // The expression used to AND every modifier, so the widened gate could
    // never see anything: no chunk contains both “比例” and “区别”.
    const expression = ftsExpression("平时作业占成绩多少比例？")!;
    expect(expression).toMatch(/\) OR \(/);
    // A college still binds: its group and the activity stay ANDed, so the
    // short name cannot silently widen into every college's sports meeting.
    const college = ftsExpression("信息学院院运会")!;
    expect(college).toMatch(/\) AND \(/);
    expect(college).toContain("h4fe1x606f");
    expect(college).toContain("h9662x8fd0");
  });
});

describe("“互联网+” is a competition, not a request to browse", () => {
  it("does not ask the user to turn on 智能搜索", () => {
    expect(explicitWebRequest("挑战杯和互联网+校内选拔怎么报名？")).toBe(false);
    expect(explicitWebRequest("学校互联网+大赛")).toBe(false);
  });

  it("still recognises an explicit request", () => {
    expect(explicitWebRequest("帮我联网查一下")).toBe(true);
    expect(explicitWebRequest("网上搜一下")).toBe(true);
    expect(explicitWebRequest("互联网上查一下")).toBe(true);
  });
});
