import type { AssistantCard } from "@/domain/agent/assistant-contracts";

/** Keep the exact evidence-to-number mapping while discarding unused sources. */
export function citedAnswer(text: string, cards: AssistantCard[]) {
  const referenced = new Set(
    [...text.matchAll(/\[(?:来源\s*)?(\d+)\]/g)].map((m) => Number(m[1])),
  );
  const numbers = new Map<number, number>();
  const selected = cards.filter((card, index) => {
    const source = card.kind === "source" || card.kind === "external_source";
    return !source || referenced.has(index + 1);
  });
  selected.forEach((card, index) =>
    numbers.set(cards.indexOf(card) + 1, index + 1),
  );
  return {
    cards: selected,
    text: text.replace(/\[(?:来源\s*)?(\d+)\]/g, (marker, n: string) =>
      numbers.has(Number(n)) ? `[${numbers.get(Number(n))}]` : marker,
    ),
  };
}
