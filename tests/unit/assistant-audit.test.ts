import { expect, it } from "vitest";
import { contentIntent } from "@/lib/server/assistant/content-intent";
import {
  answersPreviousTopic,
  openParticipation,
} from "@/lib/retrieval/evidence-assessment";
import {
  paymentChannelEvidence,
  paymentSubjects,
} from "@/lib/retrieval/payment-evidence";
import { understandQuery } from "@/lib/server/assistant/query-understanding";
import type { ContentSearchResult } from "@/domain/retrieval/skills";
import type { ModelClient } from "@/domain/models/contracts";

it("keeps a new study-abroad application grounded in the current topic", () => {
  const question = "我想申请海外留学";
  const past = "我想了解奖学金制度";
  const result = contentIntent(question, [
    { id: "old", role: "user", text: past, cards: [], sequence: 1 },
  ]);
  expect(result.query).not.toContain("奖学金");
  expect(result.queryPlan.topics.map(({ id }) => id)).toContain("study_abroad");
  expect(answersPreviousTopic("不能确认奖学金制度。", question, past)).toBe(
    true,
  );
  expect(
    answersPreviousTopic("申请留学的材料与项目类型有关。", question, past),
  ).toBe(false);
});

it("keeps provider usage when valid output does not contain a valid plan", async () => {
  const usage = { promptTokens: 103, completionTokens: 7, totalTokens: 110 };
  const client = {
    generateWithTools: async () => ({ toolCalls: [], usage }),
  } as unknown as ModelClient;
  expect(
    await understandQuery(client, "办事咨询", new AbortController().signal),
  ).toMatchObject({ error: "INVALID_PLAN", usage });
});

it("requires active registration evidence even if a competition article is recent", () => {
  const now = Date.parse("2026-11-17T10:00:00+08:00");
  const active = {
    historical: false,
    eventStatus: "scheduled",
    registrationState: "open",
    registrationWindows: [{ state: "open" }],
  } as ContentSearchResult["activities"][number];
  expect(contentIntent("广外最近可以参加的竞赛").recentDiscovery).toBe(false);
  expect(openParticipation(active, "比赛报名通知", now)).toBe(true);
  for (const [patch, title] of [
    [{ registrationState: "unknown" }, "人物事迹"],
    [{ registrationState: "closed" }, "比赛报名通知"],
    [{ historical: true }, "比赛结果"],
    [{ eventStatus: "cancelled" }, "比赛报名通知"],
    [{}, "比赛颁奖典礼"],
    [{}, "比赛晋级名单"],
    [{}, "赛事回顾"],
  ] as const) {
    expect(openParticipation({ ...active, ...patch }, title, now)).toBe(false);
  }
});

it("matches the requested payment object and preserves the recharge evidence", () => {
  const original =
    "2. 大学城校区\n研究生手册\n④水、电、冷IC卡充值服务时间工作日9:00-13:00 15:00-17:30（周四下午暂停充值）。充值服务地址：学生宿舍1栋，联系电话：020-39337011。";
  const tuition = "大学城校区。学费缴费方式：登录校园支付。";
  const accommodation = "大学城校区。住宿费缴费方式：登录校园支付。";
  const card = "大学城校区。校园卡充值服务地址：生活服务中心。";
  const utilityTerms = paymentSubjects("南校水电费怎么缴费", ["水电费"]);
  expect(paymentChannelEvidence(original, "south", utilityTerms).score).toBe(2);
  expect(paymentChannelEvidence(original, "north", utilityTerms).score).toBe(0);
  expect(paymentChannelEvidence(tuition, "south", utilityTerms).score).toBe(0);
  expect(
    paymentChannelEvidence(
      accommodation,
      "south",
      paymentSubjects("住宿费怎么交", []),
    ).score,
  ).toBe(2);
  expect(
    paymentChannelEvidence(tuition, "south", paymentSubjects("学费怎么交", []))
      .score,
  ).toBe(2);
  expect(
    paymentChannelEvidence(card, "south", paymentSubjects("校园卡怎么充值", []))
      .score,
  ).toBe(2);
  expect(paymentChannelEvidence(card, "south", utilityTerms).score).toBe(0);
});

it("keeps chapter transitions out of adjacent reference chunks and activity extraction", async () => {
  const { chunkArticle } = await import("@/lib/retrieval/chunks");
  const { analyzeArticle } = await import("@/lib/ingestion/article-analysis");
  const body =
    "第一章 校园生活\n" +
    "学生宿舍服务管理。".repeat(420) +
    "\n第二章 项目管理\n活动时间：2026年11月20日14:00。报名截止：2026年11月19日。\n" +
    "项目申请应查验当期通知。".repeat(420);
  const input = {
    title: "研究生手册（全文）",
    body,
    publishedAt: "2026-11-10",
  };
  const indexed = chunkArticle(input, "licensed_full_text")!;
  const boundary = indexed.text.indexOf("第二章");
  expect(
    indexed.chunks.every(
      ({ start, end }) => end <= boundary || start >= boundary,
    ),
  ).toBe(true);
  const analysis = analyzeArticle(input);
  expect(analysis.activities).toHaveLength(0);
  expect(analysis.calendar?.reason).toBe("reference_document");
});

it("reports attachment-only policies without summarizing absent provisions", async () => {
  const { attachmentPolicyEvidenceAnswer } =
    await import("@/lib/server/assistant/evidence-answer");
  const cards = [
    {
      kind: "source",
      documentId: "policy",
      title: "本科学生奖学金管理规定",
      sourceName: "学生工作部",
      originalUrl: "https://example.invalid/policy",
      publishedAt: null,
      snippet: "正文以 PDF 附件提供。\n打开 PDF 附件",
      evidenceType: "full_text",
      classificationState: "knowledge",
      validity: "unknown",
      readable: true,
    },
  ] as const;
  const answer = attachmentPolicyEvidenceAnswer([...cards], "奖学金制度");
  expect(answer).toContain("本科学生奖学金管理规定 [1]");
  expect(answer).toContain("当前可读取的是附件入口");
  expect(
    attachmentPolicyEvidenceAnswer(
      [{ ...cards[0], snippet: "奖励分三档，学生应按年度提交。" }],
      "奖学金制度",
    ),
  ).toBeUndefined();
});
