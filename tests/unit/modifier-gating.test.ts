import { describe, expect, it } from "vitest";
import { buildQueryPlan, queryRelevance } from "@/lib/retrieval/query-plan";

// A leftover fragment is not always a subject. “里丢”, “池开放” and
// “时长不够会影响毕业” are sentence pieces no article writes, so they rank
// instead of rejecting the document that answers the question. The fifty-question
// evaluation found five such questions answered with “没有检索到正文” while the
// corpus held the answer.
describe("a clause fragment ranks instead of vetoing", () => {
  it("finds the card article for a lost-card question", () => {
    const plan = buildQueryPlan("校园里丢了校园卡怎么挂失");
    expect(plan.modifiers.map((m) => m.original)).toEqual(["里丢"]);
    expect(plan.modifiers[0].hard).toBe(false);
    expect(
      queryRelevance(plan, {
        title: "校园卡业务",
        contentSnippet:
          "校园卡丢失后可通过微信公众号、圈存机或网站自助挂失，也可持证件到校园卡管理办公室办理。",
      }).relevant,
    ).toBe(true);
  });

  it("keeps the swimming pool when the question says 开放时间", () => {
    expect(
      queryRelevance(buildQueryPlan("游泳池开放时间是什么时候"), {
        title: "体育场馆开放安排",
        contentSnippet: "游泳馆开放时间为每日6:00-8:00、16:00-21:00。",
      }).relevant,
    ).toBe(true);
  });

  it("keeps the dorm rule when the question asks for a power limit", () => {
    // The rule says “功率不超过1000瓦”, never “功率限制”.
    expect(
      queryRelevance(buildQueryPlan("宿舍可以用吹风机吗，功率限制多少"), {
        title: "广东外语外贸大学学生宿舍管理规定",
        contentSnippet: "严禁使用大功率电器，单个插座功率不超过1000瓦。",
      }).relevant,
    ).toBe(true);
  });

  it("keeps the volunteer rule when the question asks about graduation", () => {
    expect(
      queryRelevance(buildQueryPlan("志愿服务时长不够会影响毕业吗"), {
        title: "第二课堂成绩单实施办法",
        contentSnippet: "志愿服务时长不足者不予认定第二课堂学分。",
      }).relevant,
    ).toBe(true);
  });
});

describe("a question glued to a particle is a clause", () => {
  it("keeps the repair guide when the question asks where to submit", () => {
    const plan = buildQueryPlan("宿舍报修在哪里提交，多久能修？");
    expect(plan.modifiers.map((m) => m.original)).toEqual([
      "报修在",
      "提交",
    ]);
    expect(plan.modifiers.every((m) => m.hard === false)).toBe(true);
    expect(
      queryRelevance(plan, {
        title: "使用指南 | 故障报修全攻略",
        contentSnippet: "宿舍报修请通过后勤服务公众号提交，一般24小时内上门维修。",
      }).relevant,
    ).toBe(true);
  });

  it("lets a modal question fall back to lexical search", () => {
    const plan = buildQueryPlan("校门口打车方便吗，哪个门最近？");
    expect(plan.modifiers[0].hard).toBe(false);
  });
});

describe("a named subject still vetoes", () => {
  it("rejects a different lecture subject", () => {
    expect(
      queryRelevance(buildQueryPlan("人工智能讲座"), {
        title: "金融学讲座预告",
        contentSnippet: "经济分析",
      }).relevant,
    ).toBe(false);
    expect(
      queryRelevance(buildQueryPlan("人工智能讲座"), {
        title: "AI讲坛预告",
        contentSnippet: "大模型介绍",
      }).relevant,
    ).toBe(true);
  });

  it("rejects a document that shares no subject", () => {
    expect(
      queryRelevance(buildQueryPlan("辅修和双学位有什么区别？"), {
        title: "深度学习与机器学习",
        contentSnippet: "深度学习是机器学习的子集。",
      }).relevant,
    ).toBe(false);
  });

  it("still binds a named college", () => {
    expect(
      queryRelevance(buildQueryPlan("信息学院院运会"), {
        title: "英语教育学院院运会",
        contentSnippet: "英语教育学院第二十一届院运会。",
      }).relevant,
    ).toBe(false);
  });

  it("still binds a number or a code", () => {
    expect(
      queryRelevance(buildQueryPlan("云山学术沙龙414期"), {
        title: "云山学术沙龙412期",
      }).relevant,
    ).toBe(false);
  });
});
