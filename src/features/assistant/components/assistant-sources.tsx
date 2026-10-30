import { ChevronDown, Link2 } from "lucide-react";
import Link from "next/link";
import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import { sourcePublicationDate } from "@/lib/retrieval/source-date";
import { containsToolProtocol } from "@/lib/assistant-output";
import {
  campusFoodQuery,
  matchesQueryFocus,
  queryFocus,
} from "@/lib/retrieval/query-focus";

export function AssistantSources({
  cards,
  text,
  question = "",
}: {
  cards: AssistantCard[];
  text?: string;
  question?: string;
}) {
  if (containsToolProtocol(text || "")) return null;
  const candidates = cards.flatMap((card, index) =>
    (card.kind === "source" || card.kind === "external_source") &&
    matchesQueryFocus(queryFocus(question), card, campusFoodQuery(question))
      ? [{ card, number: index + 1 }]
      : [],
  );
  const referenced = new Set(
    [...(text || "").matchAll(/\[(?:来源\s*)?(\d+)\]/g)].map((m) =>
      Number(m[1]),
    ),
  );
  const cited = candidates.filter((source) => referenced.has(source.number));
  const sources = cited.length ? cited : candidates;
  if (!sources.length) return null;
  const calendarLinks = [
    ...new Map(
      sources
        .flatMap(({ card }) =>
          card.kind === "source" ? card.calendarLinks || [] : [],
        )
        .map((link) => [link.href, link]),
    ).values(),
  ];
  return (
    <>
      {calendarLinks.length > 0 && (
        <div className="assistant-calendar-links">
          {calendarLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              活动日历 · {link.title}
            </Link>
          ))}
        </div>
      )}
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
    </>
  );
}
