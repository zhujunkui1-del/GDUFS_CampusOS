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
  expect(inputGate("文采园", [])).toBe("off_topic");
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
