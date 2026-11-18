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
import { AddTaskButton } from "@/features/account/personal-tasks";
import { useFavoriteTracking } from "@/features/content/favorites-context";
import type { PublicArticleSummary } from "@/features/content/public-feed";
import { calendarArticleSummary as articleSummary } from "./activity-summary";
import "./calendar.css";
type Result = {
  items: CalendarItem[];
  dailyCounts: Record<string, number>;
  nextEventDay: string | null;
  total: number;
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
    [detailId, setDetailId] = useState(""),
    [detailSourceId, setDetailSourceId] = useState(""),
    [article, setArticle] = useState<{
      summary: PublicArticleSummary;
      event?: CalendarItem;
    } | null>(null);
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
      setDetailSourceId(q.get("article") || "");
      if (!q.get("event") && !q.get("article")) setArticle(null);
    };
    load();
    window.addEventListener("popstate", load);
    return () => window.removeEventListener("popstate", load);
  }, [queryString]);
  function choose(d: string) {
    setDate(d);
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
      all: "1",
    });
    // Each response carries full weekly counts; no per-day model or index rebuild.
    Promise.resolve()
      .then(() => {
        if (abort.signal.aborted) throw Error("ABORTED");
        setBusy(true);
        setError("");
        setData(undefined);
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
        if (!abort.signal.aborted) setData(r);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "活动暂时无法加载。");
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [date, first, last, refresh]);
  useEffect(() => {
    if ((!detailId && !detailSourceId) || !date) return;
    const abort = new AbortController();
    const read = async (params: URLSearchParams) => {
      const response = await fetch("/api/public/activities?" + params, {
        signal: abort.signal,
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok || !body.ok)
        throw Error(body.error?.message || "活动详情暂时无法加载。");
      return body.data.items as CalendarItem[];
    };
    const load = async () => {
      let items: CalendarItem[] = [];
      if (detailId) {
        try {
          items = await read(new URLSearchParams({ event: detailId }));
        } catch (error) {
          // An old event id can expire while its source article remains public.
          // In that case the article id below is the stable recovery path.
          if (!detailSourceId) throw error;
        }
      }
      if (
        detailSourceId &&
        !items.some((item) =>
          item.sources.some((source) => source.documentId === detailSourceId),
        )
      )
        items = await read(
          new URLSearchParams({ articleId: detailSourceId, day: date }),
        );
      const item = items[0];
      if (!item && detailSourceId) {
        const response = await fetch(
          "/api/public/article?id=" + encodeURIComponent(detailSourceId),
          { signal: abort.signal, cache: "no-store" },
        );
        const body = await response.json();
        if (!response.ok || !body.ok) throw Error("ARTICLE_UNAVAILABLE");
        const source = body.data;
        return {
          summary: {
            id: source.id,
            version: source.version,
            title: source.title,
            url: source.url,
            publishedAt: source.publishedAt,
            readable: true,
            contentType: source.contentType,
            knowledgeCategory: source.knowledgeCategory,
            radarCategory: source.radarCategory,
            hasRegistration: source.hasRegistration,
            source: { name: source.sourceName, official: source.official },
          } satisfies PublicArticleSummary,
          event: undefined,
        };
      }
      if (!item) throw Error("ARTICLE_UNAVAILABLE");
      const source =
        item.sources.find((source) => source.documentId === detailSourceId) ??
        item.sources[0];
      return {
        summary: articleSummary(item, source),
        event: items.length === 1 ? item : undefined,
      };
    };
    load()
      .then((item) => !abort.signal.aborted && setArticle(item))
      .catch(() => {
        if (abort.signal.aborted) return;
        setArticle(null);
        setDetailId("");
        setDetailSourceId("");
        const url = new URL(window.location.href);
        url.searchParams.delete("event");
        url.searchParams.delete("article");
        history.replaceState(null, "", url);
      });
    return () => abort.abort();
  }, [detailId, detailSourceId, date]);
  function open(item: CalendarItem, source: CalendarItem["sources"][number]) {
    setArticle({ summary: articleSummary(item, source), event: item });
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
            href={`/map?place=${encodeURIComponent(item.mapPlace.placeId)}${item.mapPlace.campus === "baiyun" ? "&campus=baiyun" : ""}`}
          >
            <MapPin size={15} />
            在校园地图查看
          </Link>
        )}
        <div className="calendar-event-favorite">
          <FavoriteButton articleId={source.documentId} surface="calendar" />
          <AddTaskButton
            article={{
              articleId: source.documentId,
              title: source.title,
              event: item,
              day: date,
            }}
          />
        </div>
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
      {article && (
        <PublicArticleDialog
          article={article.summary}
          taskButton={
            <AddTaskButton
              article={{
                articleId: article.summary.id,
                title: article.summary.title,
                event: article.event,
                day: article.event?.dates.includes(date) ? date : undefined,
              }}
            />
          }
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
