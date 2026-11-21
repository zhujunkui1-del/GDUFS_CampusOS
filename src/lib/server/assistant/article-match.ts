import { articleTitleKey } from "@/lib/retrieval/article-title";
import { buildQueryPlan } from "@/lib/retrieval/query-plan";

/** A quoted/column title in the request names the document even when the
 * retriever's topic plan cannot see the punctuation variant. */
export function queryTitleFragments(query: string) {
  const text = query.normalize("NFKC");
  const quoted = [
    ...text.matchAll(/[“"「『《]([^”"」』》]{4,120})[”"」』》]/g),
  ].map((match) => match[1]);
  const columns = text
    .split(/[|｜\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4 && part.length <= 120);
  return [...quoted, ...columns];
}

export function matchesTargetTitle(query: string, title: string) {
  const key = articleTitleKey(title);
  if (!key) return false;
  return queryTitleFragments(query).some((fragment) => {
    const wanted = articleTitleKey(fragment);
    return (
      wanted.length >= 4 &&
      (key.includes(wanted) || wanted.includes(key) || key === wanted)
    );
  });
}

/** An official page found by web search is usable evidence even when the
 * internal corpus has no hit; the article-not-found path must not override it. */
export function hasMatchingExternalArticle(
  cards: Array<{ kind: string; title?: string }>,
  articleQuery: string | undefined,
) {
  if (!articleQuery) return false;
  return cards.some(
    (card) =>
      card.kind === "external_source" &&
      !!card.title &&
      matchesTargetTitle(articleQuery, card.title),
  );
}

/** A hard entity/modifier names the subject the user wants. An article that
 * shares only the account/source name (three bookkeeping posts from the same
 * cat-rescue account) is a different subject, not evidence for the adoption
 * notice. */
export function missesHardSubject(
  plan: ReturnType<typeof buildQueryPlan>,
  hit: { title: string; contentSnippet: string },
) {
  const subjects = [
    ...plan.entities,
    ...plan.modifiers.filter((modifier) => modifier.hard).map((m) => m.original),
  ];
  if (!subjects.length) return false;
  const text = articleTitleKey(hit.title + " " + hit.contentSnippet);
  return !subjects.some((subject) => {
    const key = articleTitleKey(subject);
    return key.length >= 2 && text.includes(key);
  });
}
