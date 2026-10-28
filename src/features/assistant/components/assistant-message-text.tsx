import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import {
  assistantDisplayText,
  containsToolProtocol,
} from "@/lib/assistant-output";
import {
  campusFoodQuery,
  matchesQueryFocus,
  queryFocus,
} from "@/lib/retrieval/query-focus";
export function AssistantMessageText({
  text,
  cards,
  question = "",
}: {
  text: string;
  cards: AssistantCard[];
  question?: string;
}) {
  if (containsToolProtocol(text)) return <>{assistantDisplayText(text)}</>;
  const clean = text.replace(/\*\*(.*?)\*\*/g, "$1");
  const parts = clean.split(/(\[来源\s*\d+\s*\])/g);
  return (
    <>
      {parts.map((part, index) => {
        const matched = /^\[来源\s*(\d+)\s*\]$/.exec(part);
        if (!matched) return part;
        const number = Number(matched[1]),
          source = cards[number - 1];
        if (
          !source ||
          (source.kind !== "source" && source.kind !== "external_source")
        )
          return part;
        if (
          !matchesQueryFocus(
            queryFocus(question),
            source,
            campusFoodQuery(question),
          )
        )
          return null;
        return (
          <sup className="assistant-citation" key={index}>
            <a
              href={source.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={source.title}
              aria-label={"来源" + number + "：" + source.title}
            >
              【来源】
            </a>
          </sup>
        );
      })}
    </>
  );
}
