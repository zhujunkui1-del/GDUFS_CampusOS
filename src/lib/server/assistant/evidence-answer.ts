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
    (playful
      ? "本鱼取到了这些有出处的原文信息：\n"
      : "已取得这些相关原文信息：\n") +
    candidates
      .map(
        ({ card, quote, number }) =>
          `- ${card.publishedAt ? chinaDay(card.publishedAt) || "日期未注明" : "日期未注明"}：“${quote}${quote.length === 130 ? "…" : ""}”[来源${number}]`,
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
) {
  const plan = buildQueryPlan(question);
  const currentOpportunity = ["participation", "registration"].includes(
    plan.goal,
  );
  const today = chinaDay(Date.now())!;
  const candidates = cards
    .map((c, index) => ({ c, index }))
    .sort((a, b) =>
      ["participation", "registration", "discovery"].includes(plan.goal)
        ? Number(b.c.kind === "external_source") -
          Number(a.c.kind === "external_source")
        : 0,
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
        return [];
      if (
        c.kind === "external_source" &&
        (c.evidenceKind === "title_only" ||
          (officialOnly && c.authority !== "official"))
      )
        return [];
      const normalized = c.snippet.replace(/\s+/g, " ").trim();
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
              text: `- ${c.title}： “${quote}${quote.length === 160 ? "…" : ""}”[来源${index + 1}]`,
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
    ? "活动日期、报名开放、名额及参加资格须分别核对；信息未给出时不能认定当前可参加。"
    : "原文未给出的条件或流程不能补齐，政策现行有效性仍需核对。";
  return (
    "已找到相关原文，以下是可核对的信息：\n" +
    excerpts.join("\n") +
    "\n以上为原文摘录。" +
    boundary
  );
}
