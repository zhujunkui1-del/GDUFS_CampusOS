import { expect, it } from "vitest";
import { inputGate, inputGateReply } from "@/lib/server/assistant/input-gate";
import { contentReadPlan } from "@/lib/server/assistant/read-plan";
import { externalPolicy } from "@/lib/server/external-search/policy";
import { expressionConflicts } from "@/lib/server/assistant/grounding";
import { claimsMapAction, unsupportedUrls } from "@/lib/assistant-output";

const campusHistory = [
  { role: "user" as const, text: "广外宿舍怎么样" },
  { role: "assistant" as const, text: "..." },
];

it("classifies every turn before retrieval", () => {
  expect(inputGate("你好")).toBe("greeting");
  expect(inputGate("你妈似了")).toBe("blocked");
  expect(inputGate("广外有医院吗")).toBe("campus");
  expect(inputGate("北京今天天气怎么样")).toBe("off_topic");
  expect(inputGate("？？？？")).toBe("vague");
  expect(inputGate("123456789")).toBe("vague");
  // A short alias after a campus turn keeps the campus context.
  expect(inputGate("文采园", campusHistory)).toBe("campus");
  expect(inputGate("巴黎铁塔", [])).toBe("off_topic");
  // A campus history must not let a distant-city weather question through.
  expect(inputGate("北京今天天气怎么样", campusHistory)).toBe("off_topic");
  // Map labels with a suffix outside the old keyword list are still campus.
  expect(inputGate("4号门在哪")).toBe("campus");
  expect(inputGate("B8学术报告厅在哪")).toBe("campus");
  expect(inputGate("京东物流在哪")).toBe("campus");
  // A bare campus event name the fixed keyword list does not know yet.
  expect(inputGate("秋之声")).toBe("campus");
  expect(inputGate("了解下秋之声")).toBe("campus");
  // Corner-bracket titles are the citation style used by campus articles.
  expect(
    inputGate("帮我找到「光影无界·师生影像作品展」这篇文章"),
  ).toBe("campus");
  // A follow-up about the topic the user just named must stay campus even when
  // the fixed keyword list does not contain that event name.
  expect(
    inputGate("2026年的秋之声什么时候举行", [{ role: "user", text: "秋之声" }]),
  ).toBe("campus");
});

it("uses fixed replies and never sends blocked or unrelated turns to search", () => {
  expect(inputGateReply("blocked")).toBe(
    "这个问题我没办法帮你，有校园相关的问题可以继续问我。",
  );
  expect(inputGateReply("off_topic")).toContain("只负责广外校园");
  expect(inputGateReply("greeting")).toContain("校园问题");
});

it("retries the same entity with its official alias when no body exists", () => {
  const policy = externalPolicy("门诊楼在哪里");
  const plan = contentReadPlan(
    ["search_campus_knowledge"],
    "门诊楼在哪里",
    policy,
    () => false,
    "门诊楼在哪里",
    () => false,
  );
  const queries = plan.map((read) => read.input.query);
  expect(queries).toContain("门诊部在哪里");
  expect(plan.some((read) => read.when?.() === true)).toBe(true);
});

it("skips alias retries once a usable body has been found", () => {
  const plan = contentReadPlan(
    ["search_campus_knowledge"],
    "门诊楼在哪里",
    externalPolicy("门诊楼在哪里"),
    () => false,
    "门诊楼在哪里",
    () => true,
  );
  const retries = plan.filter((read) => read.when);
  expect(retries.length).toBeGreaterThan(0);
  expect(retries.every((read) => read.when?.() === false)).toBe(true);
});

it("rejects unsupported [n] citations, map claims without a receipt and invented URLs", () => {
  expect(expressionConflicts("事实[2]", "daily", 1)).toContain(
    "unsupported_citation",
  );
  expect(claimsMapAction("已经帮你标出地图了")).toBe(true);
  expect(claimsMapAction("在南校生活区")).toBe(false);
  expect(
    unsupportedUrls("见 https://evil.test/x", ["https://www.gdufs.edu.cn/a"]),
  ).toEqual(["https://evil.test/x"]);
});
