import type { AssistantCard } from "@/domain/agent/assistant-contracts";
export function AssistantMessageText({
  text,
  cards,
}: {
  text: string;
  cards: AssistantCard[];
}) {
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
