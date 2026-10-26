import { ChevronDown, Link2 } from "lucide-react";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { sourcePublicationDate } from "@/lib/retrieval/source-date";

export function AssistantSources({ cards }: { cards: AssistantCard[] }) {
  const sources = cards.flatMap((card, index) =>
    card.kind === "source" || card.kind === "external_source"
      ? [{ card, number: index + 1 }]
      : [],
  );
  if (!sources.length) return null;
  return (
    <details className="assistant-sources">
      <summary>
        <Link2 size={16} aria-hidden="true" />
        <span>{sources.length} 个来源</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="assistant-sources-chevron"
        />
      </summary>
      <div className="assistant-source-list">
        {sources.map(({ card, number }) => (
          <article
            className="assistant-source-card"
            key={card.kind === "source" ? card.documentId : card.originalUrl}
          >
            <a
              href={card.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <strong>{card.title}</strong>
            </a>
            <span>
              来源{number} · {card.sourceName} ·{" "}
              {sourcePublicationDate(card.publishedAt)}
            </span>
          </article>
        ))}
      </div>
    </details>
  );
}
