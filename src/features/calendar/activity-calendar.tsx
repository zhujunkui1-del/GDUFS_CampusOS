"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  MapPin,
  ArrowUpRight,
  X,
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
import type { PublicArticleSummary } from "@/features/content/public-feed";
import "./calendar.css";
type Result = {
  items: CalendarItem[];
  dailyCounts: Record<string, number>;
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
  const [date, setDate] = useState(""),
    [category, setCategory] = useState(""),
    [campus, setCampus] = useState(""),
    [registration, setRegistration] = useState("");
  const [data, setData] = useState<Result>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<CalendarItem | null>(null),
    [detailId, setDetailId] = useState(""),
    [article, setArticle] = useState<PublicArticleSummary | null>(null);
  const week = date ? weekOf(date) : [],
    first = week[0],
    last = week[6];
  useEffect(() => {
    const load = () => {
      const q = new URLSearchParams(window.location.search),
        d = q.get("date");
      setDate(d && CalendarDateSchema.safeParse(d).success ? d : chinaDate());
      setDetailId(q.get("event") || "");
    };
    load();
    window.addEventListener("popstate", load);
    return () => window.removeEventListener("popstate", load);
  }, []);
  function choose(d: string) {
    setDate(d);
    setCursor(null);
    setSelected(null);
    setDetailId("");
    const u = new URL(window.location.href);
    u.searchParams.set("date", d);
    u.searchParams.delete("event");
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
      ...(category ? { category } : {}),
      ...(campus ? { campus } : {}),
      ...(registration ? { registration } : {}),
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
  }, [date, first, last, category, campus, registration, cursor, refresh]);
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
      .then(setSelected)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [detailId]);
  function open(item: CalendarItem) {
    setSelected(item);
    const u = new URL(window.location.href);
    u.searchParams.set("date", date);
    u.searchParams.set("event", item.eventId);
    history.replaceState(null, "", u);
  }
  const timed = (data?.items || []).filter(
      (g) => !!occurrenceTime(date, g.activity).startTime,
    ),
    untimed = (data?.items || []).filter(
      (g) => !occurrenceTime(date, g.activity).startTime,
    );
  function eventCard(item: CalendarItem) {
    return (
      <button
        type="button"
        key={item.eventId}
        className="calendar-event"
        style={articleThemeStyle(item.activity.category || "calendar")}
        onClick={() => open(item)}
        data-event-id={item.eventId}
      >
        <span className="calendar-event-meta">
          <span className="calendar-category">{catLabel(item)}</span>
          {item.historical && <span>历史活动</span>}
          {labels[item.registrationState] && (
            <span>{labels[item.registrationState]}</span>
          )}
        </span>
        <strong>{item.activity.title}</strong>
        <span className="calendar-event-facts">
          <span>
            {fmt(date)}
            {timeText(item, date) && ` · ${timeText(item, date)}`}
          </span>
          {item.activity.placeRaw && (
            <span>
              <MapPin size={15} />
              {item.activity.placeRaw}
            </span>
          )}
          {item.activity.organizer && <span>{item.activity.organizer}</span>}
        </span>
      </button>
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
      <div className="calendar-filters">
        <select
          aria-label="活动类别"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setCursor(null);
          }}
        >
          <option value="">全部类别</option>
          {radarCategories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          aria-label="校区"
          value={campus}
          onChange={(e) => {
            setCampus(e.target.value);
            setCursor(null);
          }}
        >
          <option value="">全部校区</option>
          <option value="university_town">大学城校区</option>
          <option value="baiyun">白云山校区</option>
          <option value="online">线上活动</option>
        </select>
        <select
          aria-label="报名状态"
          value={registration}
          onChange={(e) => {
            setRegistration(e.target.value);
            setCursor(null);
          }}
        >
          <option value="">全部报名状态</option>
          {Object.entries(labels).map(([code, label]) => (
            <option value={code} key={code}>
              {label}
            </option>
          ))}
          <option value="unknown">未注明报名安排</option>
        </select>
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
      <div className="calendar-day-heading">
        <h2>{date && `${fmt(date)} ${weekday(date)}`}</h2>
        {data && <span>{data.total} 场活动</span>}
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
            <p>这一天暂无符合条件的活动</p>
          </div>
        )}
      </div>
      <div className="calendar-agenda">
        {timed.map((item) => (
          <div key={item.eventId} className="calendar-timed">
            <time>{occurrenceTime(date, item.activity).startTime}</time>
            {eventCard(item)}
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
      {selected && (
        <ActivityDetails
          item={selected}
          onClose={() => {
            setSelected(null);
            setDetailId("");
            const u = new URL(window.location.href);
            u.searchParams.delete("event");
            history.replaceState(null, "", u);
          }}
          onRead={(source) =>
            setArticle({
              id: source.documentId,
              version: source.version,
              title: source.title,
              url: source.originalUrl,
              publishedAt: source.publishedAt,
              readable: source.bodyAvailable,
              contentType: "event",
              knowledgeCategory: null,
              radarCategory: selected.activity.category,
              source: { name: source.source.name, official: false },
            })
          }
        />
      )}
      {article && (
        <PublicArticleDialog
          article={article}
          categoryLabel="活动原文"
          onClose={() => setArticle(null)}
        />
      )}
    </section>
  );
}
function ActivityDetails({
  item,
  onClose,
  onRead,
}: {
  item: CalendarItem;
  onClose: () => void;
  onRead: (source: CalendarItem["sources"][number]) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  const a = item.activity,
    start = a.startsAt?.date,
    end = a.endsAt?.date;
  return (
    <dialog
      ref={ref}
      className="calendar-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="calendar-event-title"
    >
      <div className="calendar-dialog-head">
        <span>{catLabel(item)}</span>
        <button type="button" aria-label="关闭活动详情" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      <h2 id="calendar-event-title">{a.title}</h2>
      <div className="calendar-detail-facts">
        {start && (
          <p>
            {fmt(start)}
            {end && end !== start ? ` — ${fmt(end)}` : ""}
            {a.startsAt?.at && ` · ${a.startsAt.at.slice(11, 16)}`}
            {a.endsAt?.at && `–${a.endsAt.at.slice(11, 16)}`}
          </p>
        )}
        {a.placeRaw && (
          <p>
            <MapPin size={17} />
            {a.placeRaw}
          </p>
        )}
        {a.organizer && <p>主办方：{a.organizer}</p>}
        {labels[item.registrationState] && (
          <p>{labels[item.registrationState]}</p>
        )}
        {item.historical && <p>历史活动</p>}
      </div>
      {item.mapPlace && (
        <Link
          className="calendar-map-link"
          href={`/map?place=${encodeURIComponent(item.mapPlace.placeId)}`}
        >
          <MapPin size={17} />
          在校园地图查看
        </Link>
      )}
      <h3>来源</h3>
      <div className="calendar-sources">
        {item.sources.map((s) => (
          <article key={s.documentId}>
            <a href={s.originalUrl} target="_blank" rel="noopener noreferrer">
              {s.title}
              <ArrowUpRight size={15} />
            </a>
            <p>
              {s.source.name}
              {s.publishedAt &&
                ` · ${s.publishedAt.slice(0, 10).replaceAll("-", "/")}`}
            </p>
            {s.bodyAvailable && (
              <button type="button" onClick={() => onRead(s)}>
                站内阅读全文
              </button>
            )}
          </article>
        ))}
      </div>
      {a.calendar?.origins.map((o) => (
        <a
          key={o.id}
          className="calendar-evidence-link"
          target="_blank"
          rel="noopener noreferrer"
          href={o.url}
        >
          {o.kind === "image"
            ? "查看活动海报"
            : o.kind === "attachment"
              ? "查看附件"
              : "查看原文表格"}
          <ArrowUpRight size={14} />
        </a>
      ))}
    </dialog>
  );
}
