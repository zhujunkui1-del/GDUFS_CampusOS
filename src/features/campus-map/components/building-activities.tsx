"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, MapPin } from "lucide-react";
import type { CalendarItem } from "@/lib/server/calendar/query";
import type { PublicArticleSummary } from "@/features/content/public-feed";
import { PublicArticleDialog } from "@/features/content/public-article-dialog";
import { articleThemeStyle } from "@/features/content/article-theme";
import { calendarArticleSummary } from "@/features/calendar/activity-summary";

type Result = {
  items: CalendarItem[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
};
function when(item: CalendarItem) {
  const start = item.activity.startsAt!,
    end = item.activity.endsAt;
  const date =
    start.date!.replaceAll("-", "/") +
    (end?.date && end.date !== start.date
      ? "–" + end.date.replaceAll("-", "/")
      : "");
  const clock = start.at?.slice(11, 16);
  return (
    date +
    (clock
      ? " " +
        clock +
        (end?.at && end.date === start.date ? "–" + end.at.slice(11, 16) : "")
      : "")
  );
}
export function BuildingActivities({
  id,
  expanded,
  onMore,
  onBack,
}: {
  id: string;
  expanded: boolean;
  onMore(): void;
  onBack(): void;
}) {
  const [data, setData] = useState<Result | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [article, setArticle] = useState<PublicArticleSummary | null>(null);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(
    async (cursor: string | null, signal: AbortSignal) => {
      setBusy(true);
      setError("");
      try {
        const query = new URLSearchParams({
          placeId: id,
          limit: cursor ? "50" : "5",
          ...(cursor ? { cursor } : {}),
        });
        const response = await fetch("/api/public/activities?" + query, {
          cache: "no-store",
          signal,
        });
        const body = await response.json();
        if (!response.ok || !body.ok)
          throw Error(body.error?.message || "活动加载失败，请重试。");
        const result = body.data as Result;
        setData((previous) => ({
          ...result,
          items:
            cursor && previous
              ? [
                  ...new Map(
                    [...previous.items, ...result.items].map((item) => [
                      item.eventId,
                      item,
                    ]),
                  ).values(),
                ]
              : result.items,
        }));
      } catch (error) {
        if (!signal.aborted)
          setError(
            error instanceof Error ? error.message : "活动加载失败，请重试。",
          );
      } finally {
        if (!signal.aborted) setBusy(false);
      }
    },
    [id],
  );
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    void Promise.resolve().then(() => {
      if (!abort.signal.aborted) void load(null, abort.signal);
    });
    return () => abort.abort();
  }, [load]);
  function more() {
    onMore();
    if (data?.hasMore) void load(data.nextCursor, controller.current!.signal);
  }
  return (
    <section
      className="building-activities"
      aria-label={expanded ? "更多活动" : "活动"}
    >
      <header>
        {expanded && (
          <button type="button" onClick={onBack}>
            返回
          </button>
        )}
        <h3>{expanded ? "更多活动" : "活动"}</h3>
      </header>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load(null, controller.current!.signal)}
          >
            重试
          </button>
        </div>
      )}
      {!data && !error && <p className="building-empty">正在加载…</p>}
      {data?.total === 0 && <p className="building-empty">暂无活动</p>}
      <div className="building-activity-list">
        {(expanded ? data?.items : data?.items.slice(0, 5))?.map((item) => (
          <article
            className="building-activity-card"
            key={item.eventId}
            style={articleThemeStyle(item.activity.category || "calendar")}
          >
            <button
              type="button"
              onClick={() =>
                setArticle(calendarArticleSummary(item, item.sources[0]))
              }
            >
              <strong>{item.sources[0].title}</strong>
              <span className="building-activity-time">
                <Clock3 size={15} />
                {when(item)}
              </span>
              <span className="building-activity-place">
                <MapPin size={15} />
                {item.activity.placeRaw}
              </span>
              <span className="building-activity-source">
                {item.sources[0].source.name}
              </span>
            </button>
          </article>
        ))}
      </div>
      {!expanded && !!data && data.total > 5 && (
        <button type="button" className="building-more" onClick={more}>
          更多活动（{data.total}）
        </button>
      )}
      {expanded && data?.hasMore && (
        <button
          type="button"
          className="building-more"
          disabled={busy}
          onClick={() => void load(data.nextCursor, controller.current!.signal)}
        >
          {busy ? "正在加载…" : "加载更多"}
        </button>
      )}
      {article && (
        <PublicArticleDialog
          article={article}
          categoryLabel="活动原文"
          surface="calendar"
          onClose={() => setArticle(null)}
        />
      )}
    </section>
  );
}
