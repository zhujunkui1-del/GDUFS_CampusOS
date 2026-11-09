"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  MapPin,
  Clock3,
  RefreshCw,
} from "lucide-react";
import { radarCategories } from "@/domain/console/taxonomy";
import type { CalendarItem } from "@/lib/server/calendar/query";
import {
  weekOf,
  addDays,
  chinaDate,
  occurrenceTime,
  CalendarDateSchema,
} from "@/lib/retrieval/calendar-dates";
import { articleThemeStyle } from "@/features/content/article-theme";
import { PublicArticleDialog } from "@/features/content/public-article-dialog";
import { FavoriteButton } from "@/features/content/favorite-button";
import { useFavoriteTracking } from "@/features/content/favorites-context";
import type { PublicArticleSummary } from "@/features/content/public-feed";
import "./calendar.css";
type Result = {
  items: CalendarItem[];
  dailyCounts: Record<string, number>;
  nextEventDay: string | null;
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
};
const labels: Record<string, string> = {
  open: "报名中",
  not_started: "报名未开始",
  closed: "报名已截止",
  not_required: "无需报名",
  capacity_unknown: "额满即止",
};
const fmt = (d: string) => `${+d.slice(5, 7)}月${+d.slice(8, 10)}日`;
const weekday = (d: string) =>
  ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
    new Date(d + "T00:00:00Z").getUTCDay()
  ];
function timeText(item: CalendarItem, day: string) {
  const t = occurrenceTime(day, item.activity);
  return t.startTime
    ? t.endTime
      ? `${t.startTime}–${t.endTime}`
      : t.startTime
    : t.endTime
      ? `截至${t.endTime}`
      : null;
}
const catLabel = (item: CalendarItem) =>
  radarCategories.find((c) => c.code === item.activity.category)?.label ||
  "活动";
export function ActivityCalendar() {
  const queryString = useSearchParams().toString();
  const [date, setDate] = useState("");
  const [data, setData] = useState<Result>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [cursor, setCursor] = useState<string | null>(null),
    [detailId, setDetailId] = useState(""),
    [detailSourceId, setDetailSourceId] = useState(""),
    [article, setArticle] = useState<PublicArticleSummary | null>(null);
  useFavoriteTracking(
    (data?.items || []).flatMap((item) =>
      item.sources.map((source) => source.documentId),
    ),
  );
  const week = date ? weekOf(date) : [],
    first = week[0],
    last = week[6];
  useEffect(() => {
    const load = () => {
      const q = new URLSearchParams(window.location.search),
        d = q.get("date");
      setDate(d && CalendarDateSchema.safeParse(d).success ? d : chinaDate());
      setDetailId(q.get("event") || "");
      setCursor(null);
      setDetailSourceId(q.get("article") || "");
      if (!q.get("event")) setArticle(null);
    };
    load();
    window.addEventListener("popstate", load);
    return () => window.removeEventListener("popstate", load);
  }, [queryString]);
  function choose(d: string) {
    setDate(d);
    setCursor(null);
    setArticle(null);
    setDetailId("");
    const u = new URL(window.location.href);
    u.searchParams.set("date", d);
    u.searchParams.delete("event");
    u.searchParams.delete("article");
    history.replaceState(null, "", u);
  }
  useEffect(() => {
    if (!date) return;
    const abort = new AbortController();
    const q = new URLSearchParams({
      after: first,
      before: last,
      day: date,
      limit: "20",
      ...(cursor ? { cursor } : {}),
    });
    // Each response carries full weekly counts; no per-day model or index rebuild.
    Promise.resolve()
      .then(() => {
        if (abort.signal.aborted) throw Error("ABORTED");
        setBusy(true);
        setError("");
        if (!cursor) setData(undefined);
        return fetch("/api/public/activities?" + q, {
          signal: abort.signal,
          cache: "no-store",
        });
      })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok)
          throw Error(j.error?.message || "活动暂时无法加载。");
        return j.data as Result;
      })
      .then((r) => {
        if (!abort.signal.aborted)
          setData((old) =>
            cursor && old
              ? {
                  ...r,
                  items: [
                    ...new Map(
                      [...old.items, ...r.items].map((x) => [x.eventId, x]),
                    ).values(),
                  ],
                }
              : r,
          );
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "活动暂时无法加载。");
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [date, first, last, cursor, refresh]);
  useEffect(() => {
    if (!detailId) return;
    const abort = new AbortController();
    fetch("/api/public/activities?event=" + encodeURIComponent(detailId), {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.ok || !j.data.items[0])
          throw Error("活动已更新或不再公开。");
        return j.data.items[0] as CalendarItem;
      })
      .then((item) =>
        setArticle(
          articleSummary(
            item,
            item.sources.find((s) => s.documentId === detailSourceId) ||
              item.sources[0],
          ),
        ),
      )
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [detailId, detailSourceId]);
  function open(item: CalendarItem, source: CalendarItem["sources"][number]) {
    setArticle(articleSummary(item, source));
    const u = new URL(window.location.href);
    u.searchParams.set("date", date);
    u.searchParams.set("event", item.eventId);
    u.searchParams.set("article", source.documentId);
    history.replaceState(null, "", u);
  }
  const weekEmpty =
    !!data && Object.values(data.dailyCounts).every((n) => n === 0);
  const entries = (data?.items || []).flatMap((item) =>
      item.sources.map((source) => ({ item, source })),
    ),
    timed = entries.filter(
      ({ item }) => !!occurrenceTime(date, item.activity).startTime,
    ),
    untimed = entries.filter(
      ({ item }) => !occurrenceTime(date, item.activity).startTime,
    );
  function eventCard({ item, source }: (typeof entries)[number]) {
    return (
      <article
        key={item.eventId + source.documentId}
        className="calendar-event"
        style={articleThemeStyle(item.activity.category || "calendar")}
        data-event-id={item.eventId}
        data-article-id={source.documentId}
      >
        <button
          type="button"
          className="calendar-event-open"
          onClick={() => open(item, source)}
        >
          <span className="calendar-event-meta">
            <span className="calendar-category">{catLabel(item)}</span>
            {item.historical && <span>历史活动</span>}
            {labels[item.registrationState] && (
              <span>{labels[item.registrationState]}</span>
            )}
          </span>
          <strong>{source.title}</strong>
          <span className="calendar-event-facts">
            <span className="calendar-event-time">
              <Clock3 size={15} />
              {timeText(item, date) || fmt(date)}
            </span>
            {item.activity.placeRaw && (
              <span className="calendar-event-place">
                <MapPin size={15} />
                {item.activity.placeRaw}
              </span>
            )}
            <span className="calendar-event-source">{source.source.name}</span>
          </span>
        </button>
        {item.mapPlace && (
          <Link
            className="calendar-map-link"
            href={`/map?place=${encodeURIComponent(item.mapPlace.placeId)}`}
          >
            <MapPin size={15} />
            在校园地图查看
          </Link>
        )}
        <FavoriteButton
          articleId={source.documentId}
          surface="calendar"
          className="calendar-event-favorite"
        />
      </article>
    );
  }
  return (
    <section className="module-page public-calendar">
      <div className="page-heading">
        <h1 className="module-heading-title">
          <Link className="module-brand" href="/map">
            广外通 <span>CampusOS</span>
          </Link>
          <span className="module-heading-separator" aria-hidden="true">
            {" "}
            |{" "}
          </span>
          <strong>活动日历</strong>
        </h1>
      </div>
      <div className="calendar-controls">
        <div className="calendar-period">
          <button
            type="button"
            aria-label="上一周"
            disabled={!date}
            onClick={() => choose(addDays(date, -7))}
          >
            <ChevronLeft size={20} />
          </button>
          <h2>{date && `${fmt(first)} — ${fmt(last)}`}</h2>
          <button
            type="button"
            aria-label="下一周"
            disabled={!date}
            onClick={() => choose(addDays(date, 7))}
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="calendar-date-actions">
          <button type="button" onClick={() => choose(chinaDate())}>
            今天
          </button>
          <label className="calendar-picker">
            <CalendarDays size={17} />
            <input
              aria-label="选择日期"
              type="date"
              value={date}
              min="2000-01-01"
              max="2099-12-31"
              onChange={(e) => e.target.value && choose(e.target.value)}
            />
          </label>
          <button
            type="button"
            aria-label="刷新活动"
            disabled={busy}
            onClick={() => {
              setCursor(null);
              setRefresh((n) => n + 1);
            }}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>
      <div className="calendar-week" aria-label="一周日期">
        {week.map((d) => (
          <button
            type="button"
            key={d}
            aria-pressed={date === d}
            aria-label={`${d} ${weekday(d)} ${data?.dailyCounts[d] ?? 0}场活动`}
            onClick={() => choose(d)}
            className={d === chinaDate() ? "is-today" : ""}
          >
            <span>{d === chinaDate() ? "今天" : weekday(d)}</span>
            <strong>{+d.slice(8)}</strong>
            <small>{data ? `${data.dailyCounts[d] || 0} 场` : "—"}</small>
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {error && (
          <div className="calendar-empty" role="alert">
            {error}
            <button
              type="button"
              onClick={() => {
                setCursor(null);
                setRefresh((n) => n + 1);
              }}
            >
              重试
            </button>
          </div>
        )}
        {busy && !data && <div className="calendar-loading">正在加载活动…</div>}
        {!busy && !error && data?.items.length === 0 && (
          <div className="calendar-empty">
            <CalendarDays size={28} />
            <p>
              {weekEmpty
                ? "本周暂无符合条件的活动"
                : "这一天暂无符合条件的活动"}
            </p>
            {weekEmpty && data.nextEventDay && (
              <button type="button" onClick={() => choose(data.nextEventDay!)}>
                {fmt(data.nextEventDay)}有活动
              </button>
            )}
          </div>
        )}
      </div>
      <div className="calendar-agenda">
        {timed.map((entry) => (
          <div
            key={entry.item.eventId + entry.source.documentId}
            className="calendar-timed"
          >
            <time>{occurrenceTime(date, entry.item.activity).startTime}</time>
            {eventCard(entry)}
          </div>
        ))}
        {untimed.length > 0 && (
          <section className="calendar-untimed">
            <h3>未注明具体时间</h3>
            {untimed.map(eventCard)}
          </section>
        )}
      </div>
      {data?.hasMore && (
        <button
          type="button"
          className="calendar-more"
          disabled={busy}
          onClick={() => setCursor(data.nextCursor)}
        >
          {busy ? "正在加载…" : "加载更多"}
        </button>
      )}
      {article && (
        <PublicArticleDialog
          article={article}
          categoryLabel="活动原文"
          surface="calendar"
          onClose={() => {
            setArticle(null);
            setDetailId("");
            setDetailSourceId("");
            const u = new URL(window.location.href);
            u.searchParams.delete("event");
            u.searchParams.delete("article");
            history.replaceState(null, "", u);
          }}
        />
      )}
    </section>
  );
}
function articleSummary(
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
