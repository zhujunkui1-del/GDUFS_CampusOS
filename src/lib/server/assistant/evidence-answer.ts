import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { containsToolProtocol } from "@/lib/assistant-output";
import { matchesQueryFocus } from "@/lib/retrieval/query-focus";
import { chinaDay } from "./time-window";

/** A provider failure does not erase already-retrieved public evidence. No invented summary. */
export function foodEvidenceAnswer(
  cards: AssistantCard[],
  question: string,
  playful: boolean,
) {
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
