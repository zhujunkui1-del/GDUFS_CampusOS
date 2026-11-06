import type { AssistantCard } from "@/domain/agent/assistant-contracts";
import type { EvidenceHit } from "@/domain/retrieval/contracts";
import type { SqlDatabase } from "./database";
import { contentIntent } from "./content-intent";
import type { StoredMessage } from "@/domain/agent/assistant-contracts";
import { searchContent } from "../retrieval/skills";

export type DeepThinkingEvidence = {
  context: string;
  cards: AssistantCard[];
  available: boolean;
};

function recentCursor(history: StoredMessage[]) {
  const last = [...history].reverse().find((message) => message.role === "assistant");
  const sources = (last?.cards || [])
    .filter(
      (card): card is Extract<AssistantCard, { kind: "source" }> =>
        card.kind === "source" && !!card.publishedAt,
    )
    .sort(
      (a, b) =>
        String(b.publishedAt).localeCompare(String(a.publishedAt)) ||
        a.documentId.localeCompare(b.documentId),
    );
  const tail = sources.at(-1);
  return tail ? { at: tail.publishedAt!, id: tail.documentId } : undefined;
}

function campusContext(hits: EvidenceHit[]) {
  if (!hits.length)
    return "本轮已查询 CampusOS D1 公开文章，未找到相关公开记录。不要用模型记忆补写广外具体事实；简短说明当前没有检索到可用的站内依据。";
  return [
    "以下是 CampusOS 服务端从 D1 当前公开文章检索到的证据摘录。D1 是 CampusOS 校园信息事实源；文章标题、来源、发布日期、原文链接和摘录均来自当前公开数据。摘录不是整篇文章。只把摘录直接支持的内容作为校园事实，并在相关句子后使用对应的 [编号] 引用。若证据不足，明确说哪些部分无法确认。",
    ...hits.map(
      (hit, index) =>
        `[${index + 1}]\n标题：${hit.title}\n来源：${hit.sourceName}\n发布日期：${hit.publishedAt || "未记录"}\n原文：${hit.originalUrl}\n证据类型：${hit.evidenceType}${hit.bodyPartial ? "（正文为部分内容）" : ""}\n摘录：${hit.bodyAvailable ? hit.contentSnippet : "只有标题/元数据，没有可引用正文。"}`,
    ),
  ].join("\n\n");
}

export async function retrieveDeepThinkingEvidence(
  db: SqlDatabase,
  message: string,
  history: StoredMessage[],
  signal: AbortSignal,
): Promise<DeepThinkingEvidence> {
  const intent = contentIntent(message, history);
  if (!intent.active)
    return {
      context: "本轮没有需要检索的校园事实；按普通对话处理，不虚构已执行校园查询。",
      cards: [],
      available: true,
    };

  const hits: EvidenceHit[] = [];
  let available = true;
  for (const tool of intent.tools.slice(0, 2)) {
    const purpose = tool === "search_campus_events" ? "events" : "knowledge";
    const query = intent.retrievalQuery || intent.query;
    const input: Record<string, unknown> = {
      query,
      limit: 4,
      ...(intent.articleLookup && intent.articleQuery
        ? { title: intent.articleQuery }
        : {}),
      ...(intent.recentDiscovery
        ? {
            sort: "published_desc",
            ...(intent.discoveryFollowup
              ? { publishedCursor: recentCursor(history) }
              : {}),
          }
        : {}),
    };
    if (purpose === "events" && intent.radarCategory)
      input.category = intent.radarCategory;
    if (purpose === "events" && intent.timeWindow) {
      if (intent.timeWindow.role === "publication") {
        input.publishedAfter = intent.timeWindow.after;
        input.publishedBefore = intent.timeWindow.before;
      } else {
        input.after = intent.timeWindow.after;
        input.before = intent.timeWindow.before;
        input.timeRole = intent.timeWindow.role;
      }
    }
    try {
      const result = await searchContent(
        db,
        purpose,
        input as Parameters<typeof searchContent>[2],
        new Date().toISOString(),
        signal,
      );
      hits.push(...result.hits);
    } catch {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      available = false;
    }
  }

  const unique = [...new Map(hits.map((hit) => [hit.documentId, hit])).values()]
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 4);
  const cards: AssistantCard[] = unique.map((hit) => ({
    kind: "source",
    documentId: hit.documentId,
    title: hit.title,
    sourceName: hit.sourceName,
    originalUrl: hit.originalUrl,
    publishedAt: hit.publishedAt,
    snippet: hit.contentSnippet,
    evidenceType: hit.evidenceType,
    classificationState: hit.classificationState,
    validity: hit.validity,
    readable: hit.readable,
    ...(hit.calendarUrl
      ? {
          calendarLinks: [
            { title: hit.title, href: hit.calendarUrl },
          ],
        }
      : {}),
  }));

  return {
    context: available
      ? campusContext(unique)
      : "CampusOS D1 本轮检索服务未能完整响应。不要把检索故障说成没有相关资料，也不要使用模型记忆补写校园事实。",
    cards,
    available,
  };
}

export function citedEvidenceCards(answer: string, cards: AssistantCard[]) {
  const references = new Set(
    [...answer.matchAll(/\[(\d{1,2})\]/g)].map((match) => Number(match[1])),
  );
  if (!references.size) return [];
  return cards.filter((card, index) => references.has(index + 1));
}
