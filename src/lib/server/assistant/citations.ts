import type { AssistantCard } from "@/domain/agent/assistant-contracts";

/** `[n1]`, `[来源1]`, `【2】` and `[1]` are the same citation. */
const MARKER = /\[(?:n\s*)?(?:来源\s*)?(\d+)\]|【(?:来源\s*)?(\d+)】/g;

/**
 * The prompt asks for `[1]`, but models sometimes emit the internal
 * `[n1]` shape. The UI only renders `[n]`, so a stray letter used to leave
 * the marker as literal text and drop the source card.
 */
export function normalizeCitations(text: string) {
  return text.replace(MARKER, (_, a: string, b: string) => `[${a ?? b}]`);
}

/** Keep the exact evidence-to-number mapping while discarding unused sources. */
export function citedAnswer(text: string, cards: AssistantCard[]) {
  const normalized = normalizeCitations(text);
  const referenced = new Set(
    [...normalized.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])),
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
    text: normalized.replace(/\[(\d+)\]/g, (marker, n: string) =>
      numbers.has(Number(n)) ? `[${numbers.get(Number(n))}]` : marker,
    ),
  };
}
