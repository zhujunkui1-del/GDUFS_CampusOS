"use client";
import Link from "next/link";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { ArrowRight, RefreshCw, Search } from "lucide-react";
import {
  knowledgeCategories,
  radarCategories,
} from "@/domain/console/taxonomy";
import { PublicArticleDialog } from "./public-article-dialog";
import "./public-feed.css";

export type PublicArticleSummary = {
  id: string;
  version: number;
  title: string;
  url: string;
  readable?: boolean;
  publishedAt: string | null;
  summary: string;
  contentType: string;
  knowledgeCategory: string | null;
  radarCategory: string | null;
  source: { name: string; official: boolean };
};

type Result = {
  items: PublicArticleSummary[];
  groups?: Record<string, PublicArticleSummary[]>;
  hasMore: boolean;
  counts: Record<string, number>;
  total: number;
  nextCursor: string | null;
};
type FeedGroup = {
  category: { code: string; label: string };
  count: number;
  items: PublicArticleSummary[];
};
type FeedState = {
  key: string;
  data?: Result;
  groups?: FeedGroup[];
  counts?: Record<string, number>;
  total?: number;
  error?: string;
};

const pageSize = 12;
const columnMemory: Record<string, number> = {};

function subscribeColumns(update: () => void) {
  window.addEventListener("storage", update);
  window.addEventListener("campusos:article-columns", update);
  return () => {
    window.removeEventListener("storage", update);
    window.removeEventListener("campusos:article-columns", update);
  };
}
function savedColumns(surface: string) {
  try {
    const n = Number(
      localStorage.getItem("campusos:article-columns:" + surface),
    );
    if ([1, 2, 3, 4].includes(n)) return n;
  } catch {}
  return columnMemory[surface] || 1;
}
function themeFor(code: string) {
  let hash = 0;
  for (const char of code) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return {
    accent: `hsl(${hue} 43% 38%)`,
    tint: `hsl(${hue} 58% 96%)`,
  };
}
function themeStyle(code: string) {
  const theme = themeFor(code);
  return {
    "--feed-accent": theme.accent,
    "--feed-tint": theme.tint,
  } as CSSProperties;
}
function formatPublishTime(value: string | null) {
  if (!value) return "时间未知";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", "/");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}

export function PublicFeed({ surface }: { surface: "radar" | "knowledge" }) {
  const categories =
    surface === "radar" ? radarCategories : knowledgeCategories;
  const columns = useSyncExternalStore(
    subscribeColumns,
    () => savedColumns(surface),
    () => 1,
  );
  const [cursors, setCursors] = useState<string[]>([""]);
  const [searchDraft, setSearchDraft] = useState({ q: "", source: "" });
  const [query, setQuery] = useState({
    q: "",
    source: "",
    category: "",
    offset: 0,
  });
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<FeedState>({ key: "" });
  const [selectedArticle, setSelectedArticle] =
    useState<PublicArticleSummary | null>(null);
  const pageIndex = Math.floor(query.offset / pageSize);
  const pageCursor = cursors[pageIndex] || "";
  const key = JSON.stringify([
    surface,
    query.q,
    query.source,
    query.category,
    query.offset,
    pageCursor,
    revision,
  ]);

  useEffect(() => {
    if (
      searchDraft.q.trim() === query.q &&
      searchDraft.source.trim() === query.source
    )
      return;
    const timeout = window.setTimeout(() => {
      setCursors([""]);
      setQuery((current) => ({
        ...current,
        q: searchDraft.q.trim(),
        source: searchDraft.source.trim(),
        offset: 0,
      }));
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [searchDraft.q, searchDraft.source, query.q, query.source]);

  useEffect(() => {
    const abort = new AbortController();
    async function fetchCategory(
      category: string,
      cursor = "",
    ): Promise<Result> {
      const params = new URLSearchParams({
        surface,
        limit: String(pageSize),
        category,
      });
      if (query.q) params.set("q", query.q);
      if (query.source) params.set("source", query.source);
      if (cursor) params.set("cursor", cursor);
      return fetchResult(params);
    }
    async function fetchGrouped(): Promise<Result> {
      const params = new URLSearchParams({
        surface,
        limit: String(pageSize),
        grouped: "1",
      });
      if (query.q) params.set("q", query.q);
      if (query.source) params.set("source", query.source);
      return fetchResult(params);
    }
    async function fetchResult(params: URLSearchParams): Promise<Result> {
      const response = await fetch("/api/public/content?" + params.toString(), {
        cache: "no-store",
        signal: abort.signal,
      });
      const body = await response.json();
      if (!response.ok || !body.ok)
        throw Error(body.error?.message || "内容暂时无法加载");
      return body.data as Result;
    }
    async function load() {
      try {
        if (query.category) {
          const data = await fetchCategory(query.category, pageCursor);
          if (!abort.signal.aborted)
            setState({
              key,
              data,
              counts: data.counts,
              total: data.counts[query.category] || 0,
            });
          return;
        }
        if (!categories.length) {
          setState({ key, groups: [], counts: {}, total: 0 });
          return;
        }
        const grouped = await fetchGrouped();
        const visibleCategories = categories.filter(
          (category) => (grouped.counts[category.code] || 0) > 0,
        );
        if (!abort.signal.aborted)
          setState({
            key,
            groups: visibleCategories.map((category) => ({
              category,
              count: grouped.counts[category.code] || 0,
              items: grouped.groups?.[category.code] || [],
            })),
            counts: grouped.counts,
            total: grouped.total,
          });
      } catch (error) {
        if (!abort.signal.aborted)
          setState({
            key,
            error: error instanceof Error ? error.message : "内容暂时无法加载",
          });
      }
    }
    void load();
    return () => abort.abort();
  }, [
    categories,
    key,
    pageCursor,
    query.category,
    query.q,
    query.source,
    surface,
  ]);

  const current = state.key === key ? state : undefined;
  const title = surface === "radar" ? "校园雷达" : "校园知识";
  const selectedCategory = categories.find(
    (category) => category.code === query.category,
  );
  function chooseCategory(code: string) {
    setCursors([""]);
    setQuery((current) => ({ ...current, category: code, offset: 0 }));
  }
  function setColumns(value: number) {
    columnMemory[surface] = value;
    try {
      localStorage.setItem(
        "campusos:article-columns:" + surface,
        String(value),
      );
    } catch {
      /* Keep this visit's preference. */
    }
    window.dispatchEvent(new Event("campusos:article-columns"));
  }
  function openCard(
    event: KeyboardEvent<HTMLElement>,
    item: PublicArticleSummary,
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setSelectedArticle(item);
  }
  function renderCard(item: PublicArticleSummary) {
    return (
      <article
        className="public-feed-card"
        key={item.id}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-label={`打开文章详情：${item.title}`}
        onClick={() => setSelectedArticle(item)}
        onKeyDown={(event) => openCard(event, item)}
      >
        <span className="public-feed-card-title">{item.title}</span>
        <footer>
          <time dateTime={item.publishedAt || undefined}>
            {formatPublishTime(item.publishedAt)}
          </time>
          <span className="public-feed-source" title={item.source.name}>
            {item.source.name}
          </span>
        </footer>
      </article>
    );
  }
  function retry() {
    setRevision((value) => value + 1);
  }
  const articleCategory = selectedArticle
    ? categories.find(
        (category) =>
          category.code ===
          (surface === "radar"
            ? selectedArticle.radarCategory
            : selectedArticle.knowledgeCategory),
      )?.label || title
    : title;

  return (
    <section
      className="module-page public-feed"
      style={{ "--article-columns": columns } as CSSProperties}
    >
      <div className="page-heading">
        <h1
          className="module-heading-title"
          aria-label={`广外通 CampusOS | ${title}`}
        >
          <Link className="module-brand" href="/map">
            广外通 <span>CampusOS</span>
          </Link>
          <span className="module-heading-separator" aria-hidden="true">
            {" | "}
          </span>
          <strong>{title}</strong>
        </h1>
      </div>

      <div className="public-feed-search" role="search">
        <label className="public-feed-search-field">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="搜索标题"
            type="search"
            placeholder="搜索标题"
            maxLength={100}
            value={searchDraft.q}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSearchDraft((current) => ({
                ...current,
                q: value,
              }));
            }}
          />
        </label>
        <label className="public-feed-search-field">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="搜索来源名称"
            type="search"
            placeholder="学校、部门或机构"
            maxLength={100}
            value={searchDraft.source}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSearchDraft((current) => ({
                ...current,
                source: value,
              }));
            }}
          />
        </label>
      </div>

      <nav className="public-feed-categories" aria-label={title + "分类"}>
        {[{ code: "", label: "全部" }, ...categories].map((category) => (
          <button
            key={category.code || "all"}
            type="button"
            style={category.code ? themeStyle(category.code) : undefined}
            aria-pressed={query.category === category.code}
            onClick={() => chooseCategory(category.code)}
          >
            {category.label}
            <span className="public-feed-count">
              {current?.counts
                ? category.code
                  ? current.counts[category.code] || 0
                  : (current.total ?? 0)
                : "…"}
            </span>
          </button>
        ))}
      </nav>

      <div className="public-feed-toolbar">
        <h2>
          {selectedCategory?.label || "全部"}
          <span className="public-feed-total">
            {current?.total === undefined ? "…" : `${current.total} 篇`}
          </span>
        </h2>
        <div className="public-feed-tools">
          <label className="public-feed-columns">
            每行文章
            <select
              aria-label="每行文章数量"
              value={columns}
              onChange={(event) =>
                setColumns(Number(event.currentTarget.value))
              }
            >
              {[1, 2, 3, 4].map((number) => (
                <option key={number} value={number}>
                  {number} 列
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="public-feed-refresh"
            aria-label="刷新内容"
            title="刷新内容"
            onClick={retry}
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {!current && (
        <p role="status" className="public-feed-status">
          正在加载…
        </p>
      )}
      {current?.error && (
        <div className="public-feed-status" role="alert">
          <p>{current.error}</p>
          <button type="button" onClick={retry}>
            重试
          </button>
        </div>
      )}

      {current &&
        !current.error &&
        !query.category &&
        (current.groups?.length ? (
          <div className="public-feed-groups">
            {current.groups.map((group) => (
              <section
                className="public-feed-group"
                style={themeStyle(group.category.code)}
                key={group.category.code}
                aria-labelledby={`feed-group-${group.category.code}`}
              >
                <div className="public-feed-group-heading">
                  <h2 id={`feed-group-${group.category.code}`}>
                    <span className="public-feed-topic-tag">
                      {group.category.label}
                    </span>
                    <span className="public-feed-group-count">
                      {group.count} 篇
                    </span>
                  </h2>
                  <button
                    type="button"
                    className="public-feed-more"
                    onClick={() => chooseCategory(group.category.code)}
                  >
                    查看更多
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="public-feed-group-list">
                  {group.items.map(renderCard)}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <p className="public-feed-status">
            {query.q || query.source ? "没有找到匹配内容" : "暂无已发布内容"}
          </p>
        ))}

      {current && !current.error && query.category && (
        <>
          {current.data?.items.length ? (
            <section
              className="public-feed-group public-feed-selected-group"
              style={themeStyle(query.category)}
              aria-label={selectedCategory?.label || title}
            >
              <div className="public-feed-group-list">
                {current.data.items.map(renderCard)}
              </div>
            </section>
          ) : (
            <p className="public-feed-status">
              {query.q || query.source ? "没有找到匹配内容" : "暂无已发布内容"}
            </p>
          )}
          {current.data && (
            <div className="public-feed-pagination">
              <button
                type="button"
                disabled={!pageIndex}
                onClick={() =>
                  setQuery((current) => ({
                    ...current,
                    offset: Math.max(0, current.offset - pageSize),
                  }))
                }
              >
                上一页
              </button>
              <span>
                第 {pageIndex + 1} 页 · 共 {current.total || 0} 篇
              </span>
              <button
                type="button"
                disabled={!current.data.hasMore || !current.data.nextCursor}
                onClick={() => {
                  setCursors((values) => [
                    ...values.slice(0, pageIndex + 1),
                    current.data!.nextCursor!,
                  ]);
                  setQuery((current) => ({
                    ...current,
                    offset: current.offset + pageSize,
                  }));
                }}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}

      {selectedArticle && (
        <PublicArticleDialog
          key={selectedArticle.id}
          article={selectedArticle}
          categoryLabel={articleCategory}
          onClose={() => setSelectedArticle(null)}
        />
      )}
    </section>
  );
}
