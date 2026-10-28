import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { containsToolProtocol } from "@/lib/assistant-output";
import { matchesQueryFocus } from "@/lib/retrieval/query-focus";
import { chinaDay } from "./time-window";
import { buildQueryPlan, queryRelevance } from "@/lib/retrieval/query-plan";

/** A provider failure does not erase already-retrieved public evidence. No invented summary. */
export function foodEvidenceAnswer(
  cards: AssistantCard[],
  question: string,
  playful: boolean,
) {
  // This fallback is for ordinary dining discovery, not medical/dietary safety advice.
  if (/过敏|中毒|糖尿病|高血压|疾病|孕|医疗|服药|忌口/.test(question))
    return undefined;
  const candidates = cards
    .flatMap((card, index) => {
      if (card.kind !== "source" && card.kind !== "external_source") return [];
      if (
        !matchesQueryFocus("food", card, question) ||
        containsToolProtocol(card.snippet)
      )
        return [];
      if (
        (card.kind === "source" && card.evidenceType === "metadata") ||
        (card.kind === "external_source" &&
          card.evidenceKind !== "page_excerpt")
      )
        return [];
      const lines = card.snippet
        .split(/[\n。]+/)
        .map((line) =>
          line
            .replace(/#.*$/g, "")
            .replace(/\[[^\]]{1,20}R\]/g, "")
            .trim(),
        )
        .filter((line) =>
          /食|饭|菜|餐|粉|面|肉|锅|元|文采|博雅|风采/.test(line),
        );
      const quote = lines.join("；").slice(0, 130);
      if (!quote) return [];
      const score =
        Number(card.kind === "external_source") * 10 +
        Number(
          /一饭|第一食堂|文采园/.test(question) &&
            /一饭|文采园/.test(card.title + card.snippet),
        ) *
          4;
      return [{ card, quote, number: index + 1, score }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  if (!candidates.length) return undefined;
  return (
    (playful ? "本鱼翻到这些，先给你看：\n" : "可核对的信息：\n") +
    candidates
      .map(
        ({ card, quote, number }) =>
          `- ${card.publishedAt ? chinaDay(card.publishedAt) || "日期未注明" : "日期未注明"}：“${quote}${quote.length === 130 ? "…" : ""}”[${number}]`,
      )
      .join("\n") +
    "\n以上为原文片段，当前菜品供应以现场为准。"
  );
}
/** Bounded source excerpts remain usable when prose generation fails. This
 * reports source text, never turns unknown dates/eligibility into a recommendation. */
export function retrievedEvidenceAnswer(
  cards: AssistantCard[],
  question: string,
  officialOnly: boolean,
  officialDocumentIds: Set<string>,
  playful = false,
) {
  const plan = buildQueryPlan(question);
  const currentOpportunity = ["participation", "registration"].includes(
    plan.goal,
  );
  const today = chinaDay(Date.now())!;
  const directGuide = (c: AssistantCard) =>
    plan.goal === "procedure" &&
    (c.kind === "source" || c.kind === "external_source") &&
    /指南|流程|操作|步骤/.test(c.title);
  const canAttribute = (c: AssistantCard) =>
    directGuide(c) &&
    c.kind === "source" &&
    c.evidenceType === "full_text" &&
    c.readable &&
    !/只(?:查|看|用|要).{0,8}官方|仅(?:查|看|用).{0,8}官方/.test(question);
  const candidates = cards
    .map((c, index) => ({ c, index }))
    .sort(
      (a, b) =>
        Number(directGuide(b.c)) - Number(directGuide(a.c)) ||
        (["participation", "registration", "discovery"].includes(plan.goal)
          ? Number(b.c.kind === "external_source") -
            Number(a.c.kind === "external_source")
          : 0),
    )
    .flatMap(({ c, index }) => {
      if (c.kind !== "source" && c.kind !== "external_source") return [];
      if (!queryRelevance(plan, c).relevant || containsToolProtocol(c.snippet))
        return [];
      if (
        c.kind === "source" &&
        (c.evidenceType === "metadata" ||
          (officialOnly && !officialDocumentIds.has(c.documentId)))
      )
        if (c.evidenceType === "metadata" || !canAttribute(c)) return [];
      if (
        c.kind === "external_source" &&
        (c.evidenceKind === "title_only" ||
          (officialOnly && c.authority !== "official"))
      )
        return [];
      const normalized = c.snippet.replace(/\s+/g, " ").trim();
      const attribution =
        c.kind === "source" &&
        !officialDocumentIds.has(c.documentId) &&
        canAttribute(c)
          ? "（公开指南，官方身份及现行效力待确认）"
          : "";
      const anchor = currentOpportunity
        ? normalized.search(/定于|将于|(?:比赛|活动|讲座)(?:举办)?时间[：:]?/)
        : -1;
      const start = anchor >= 0 ? Math.max(0, anchor - 5) : 0;
      const quote = normalized.slice(start, start + 160);
      const dates = [
        ...normalized.matchAll(
          /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})(?:\s*[—至-]\s*\d{1,2})?\s*日/g,
        ),
      ].filter((m) =>
        /定于|将于|时间/.test(
          normalized.slice(Math.max(0, m.index! - 20), m.index),
        ),
      );
      const future =
        currentOpportunity &&
        dates.some(
          (m) =>
            `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` >=
            today,
        );
      return quote
        ? [
            {
              future,
              text: `- ${c.title}${attribution}： “${quote}${quote.length === 160 ? "…" : ""}”[${index + 1}]`,
            },
          ]
        : [];
    });
  const excerpts = candidates
    .filter(
      (c) =>
        !currentOpportunity || !candidates.some((c) => c.future) || c.future,
    )
    .slice(0, 3)
    .map((c) => c.text);
  if (!excerpts.length) return undefined;
  const boundary = ["participation", "registration", "discovery"].includes(
    plan.goal,
  )
    ? "具体日期、报名和资格按原文核对，没写到的别当成已经开放。"
    : "原文没写的条件不补，政策是否仍有效也要再核。";
  return (
    (playful ? "本鱼翻到这些，给你划个重点：\n" : "可核对的信息：\n") +
    excerpts.join("\n") +
    "\n" +
    boundary
  );
}
