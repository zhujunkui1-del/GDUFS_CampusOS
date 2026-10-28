import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import type { ContentSearchResult } from "@/domain/retrieval/skills";
export function isDiscoveryIndex(url: string, title: string) {
  try {
    const path = new URL(url).pathname;
    return (
      /^(?:\/(?:index\.(?:htm|html))?|\/tzgg(?:\/\d+)?\.htm|\/jsqt\/xnjs(?:\/\d+)?\.htm)\/?$/.test(
        path,
      ) && /通知公告|校内竞赛|主页|体育部/.test(title)
    );
  } catch {
    return false;
  }
}
/** An old start date is not an end date or a verified registration cutoff. */
export function unsupportedClosureClaim(
  answer: string,
  cards: AssistantCard[],
  results: ContentSearchResult[],
) {
  const activities = results.flatMap((r) => r.activities);
  for (const line of answer.split(/[\n。]/)) {
    const closed =
        /报名(?:通道)?(?:均|都)?(?:早已|已经|已)(?:截止|关闭|结束)|报名(?:均|都)?已截止/.test(
          line,
        ),
      ended = /(?:均已结束|已经结束|已结束|举办结束|举办完毕)/.test(line);
    if (!closed && !ended) continue;
    const refs = [...line.matchAll(/[\[【]来源\s*(\d+)[\]】]/g)]
      .map((m) => cards[+m[1] - 1])
      .filter(
        (c) => c && (c.kind === "source" || c.kind === "external_source"),
      );
    if (!refs.length) return true;
    for (const c of refs) {
      if (c.kind !== "source" && c.kind !== "external_source") continue;
      const a =
        c.kind === "source"
          ? activities.filter((a) => a.documentId === c.documentId)
          : [];
      if (
        closed &&
        !a.some((a) => a.registrationState === "closed") &&
        !/报名(?:已|已经)(?:截止|关闭)|报名结束/.test(c.snippet)
      )
        return true;
      if (
        ended &&
        !a.some(
          (a) => (a.endsAt?.date && a.historical) || a.eventStatus === "ended",
        ) &&
        !/已经结束|圆满落幕|落下帷幕|已结束|圆满结束/.test(c.snippet)
      )
        return true;
    }
  }
  return false;
}
