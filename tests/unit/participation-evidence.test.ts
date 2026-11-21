import { expect, it } from "vitest";
import { participationEvidenceAnswer } from "@/lib/server/assistant/evidence-answer";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import type { ContentSearchResult } from "@/domain/retrieval/skills";

const NOW = Date.parse("2026-11-21T00:00:00+08:00");

type Registration = "open" | "not_required" | "closed" | "unknown";

function activity(
  documentId: string,
  name: string,
  registrationState: Registration,
) {
  return {
    eventId: documentId,
    documentId,
    activityKey: documentId,
    name,
    kind: "event",
    category: "culture_sports",
    startsAt: {
      raw: "2026年11月26日",
      date: "2026-11-26",
      at: null,
      timezone: "Asia/Shanghai",
      precision: "day",
      resolution: "day",
      inferred: false,
      inferenceBasis: "test",
      evidence: "活动时间：2026年11月26日。",
    },
    endsAt: null,
    placeRaw: "大学城校区",
    organizer: null,
    eventStatus: "upcoming",
    historical: false,
    registrationRequirement:
      registrationState === "not_required" ? "not_required" : "required",
    registrationState,
    registrationWindows:
      registrationState === "open"
        ? [
            {
              roundLabel: null,
              start: null,
              end: {
                raw: "2026年11月24日",
                date: "2026-11-24",
                at: null,
                timezone: "Asia/Shanghai",
                precision: "day",
                resolution: "day",
                inferred: false,
                inferenceBasis: "test",
                evidence: "报名截止：2026年11月24日。",
              },
              deadlineSemantics: "closes",
              capacityLimited: false,
              state: "open",
              evidence: ["报名截止：2026年11月24日。"],
            },
          ]
        : [],
    otherDeadlines: [],
    registrationUrl: null,
    evidence: ["活动时间：2026年11月26日。"],
    mapPlace: null,
  };
}

function fixture() {
  const activities = [
    activity("open", "开放报名活动", "open"),
    activity("walk-in", "无需报名活动", "not_required"),
    activity("closed", "已截止活动", "closed"),
    activity("unknown", "报名未知活动", "unknown"),
  ];
  const cards = [...activities, activity("notice", "停课通知", "unknown")].map(
    (item) =>
      ({
        kind: "source",
        documentId: item.documentId,
        title: item.name,
        snippet: "",
      }) as unknown as AssistantCard,
  );
  const results = [
    { activities },
  ] as unknown as ContentSearchResult[];
  return { cards, results };
}

it("lists only open registration when the user asks to register", () => {
  const { cards, results } = fixture();
  const answer = participationEvidenceAnswer(
    cards,
    results,
    NOW,
    "最近还有什么可以报名的活动",
  );
  expect(answer.text).toContain("开放报名活动");
  expect(answer.text).not.toContain("无需报名活动");
  expect(answer.text).not.toContain("已截止活动");
  expect(answer.text).toContain("不代表学校没有此类活动");
});

it("lists only walk-in activities when the user refuses registration", () => {
  const { cards, results } = fixture();
  const answer = participationEvidenceAnswer(
    cards,
    results,
    NOW,
    "最近有什么不用报名就能参加的活动",
  );
  expect(answer.text).toContain("无需报名活动");
  expect(answer.text).not.toContain("开放报名活动");
  expect(answer.text).not.toMatch(/开放报名|正在报名/);
});

it("separates both categories for a mixed request", () => {
  const { cards, results } = fixture();
  const answer = participationEvidenceAnswer(
    cards,
    results,
    NOW,
    "最近还有什么可以报名或不用报名就可以参加的活动",
  );
  expect(answer.text).toContain("正在开放报名");
  expect(answer.text).toContain("开放报名活动");
  expect(answer.text).toContain("无需报名活动");
  expect(answer.text).not.toContain("已截止活动");
});

it("does not claim campus-wide absence when no open registration exists", () => {
  const { cards, results } = fixture();
  const answer = participationEvidenceAnswer(
    cards.filter(
      (card) => (card as { title?: string }).title !== "开放报名活动",
    ),
    results,
    NOW,
    "最近还有什么可以报名的活动",
  );
  expect(answer.text).toContain("没有找到可确认正在开放报名的活动");
  expect(answer.text).toContain("不代表学校没有此类活动");
  expect(answer.text).not.toContain("开放报名活动");
  expect(answer.text).not.toContain("停课通知");
});
