import type { CalendarItem } from "@/lib/server/calendar/query";
import type { PublicArticleSummary } from "@/features/content/public-feed";

export function calendarArticleSummary(
  item: CalendarItem,
  source: CalendarItem["sources"][number],
): PublicArticleSummary {
  return {
    id: source.documentId,
    version: source.version,
    title: source.title,
    url: source.originalUrl,
    publishedAt: source.publishedAt,
    readable: source.bodyAvailable,
    contentType: "event",
    knowledgeCategory: source.knowledgeCategory,
    radarCategory: item.activity.category,
    source: { name: source.source.name, official: false },
  };
}
