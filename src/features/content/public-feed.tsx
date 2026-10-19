"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type CSSProperties } from "react";
import { ArrowUpRight, Search, RefreshCw } from "lucide-react";
import {
  knowledgeCategories,
  radarCategories,
  contentTypeNames,
} from "@/domain/console/taxonomy";
import "./public-feed.css";
type Item = {
  id: string;
  version: number;
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string;
  contentType: string;
  knowledgeCategory: string | null;
  radarCategory: string | null;
  source: { name: string; official: boolean };
};
type Result = {
  items: Item[];
  hasMore: boolean;
  counts: Record<string, number>;
  total: number;
};
export function PublicFeed({ surface }: { surface: "radar" | "knowledge" }) {
  const categories =
    surface === "radar" ? radarCategories : knowledgeCategories;
  const [columns, setColumns] = useState(1);
  const [query, setQuery] = useState({
      q: "",
      source: "",
      category: "",
      offset: 0,
    }),
    [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data?: Result;
    error?: string;
  }>({ key: "" });
  const params = new URLSearchParams({
    surface,
    limit: "12",
    offset: String(query.offset),
  });
  for (const field of ["q", "source", "category"] as const)
    if (query[field]) params.set(field, query[field]);
  const path = "/api/public/content?" + params.toString(),
    key = path + ":" + revision;
  useEffect(() => {
    const abort = new AbortController();
    fetch(path, { cache: "no-store", signal: abort.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok || !body.ok)
          throw Error(body.error?.message || "内容暂时无法加载");
        return body.data as Result;
      })
      .then((data) => {
        if (!abort.signal.aborted) setState({ key, data });
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setState({
            key,
            error: e instanceof Error ? e.message : "内容暂时无法加载",
          });
      });
    return () => abort.abort();
  }, [path, key]);
  const data = state.key === key ? state.data : undefined,
    error = state.key === key ? state.error : undefined;
  function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setQuery({
      ...query,
      q: String(f.get("q") || "").trim(),
      source: String(f.get("source") || "").trim(),
      offset: 0,
    });
  }
  const title = surface === "radar" ? "校园雷达" : "校园知识";
  return (
    <section
      className="module-page public-feed"
      style={{ "--article-columns": columns } as CSSProperties}
    >
      <div className="page-heading">
        <Link className="module-brand" href="/map">
          广外通 <span>CampusOS</span>
        </Link>
        <h1>{title}</h1>
      </div>
      <form className="public-feed-search" onSubmit={search}>
        <label>
          <span>搜索标题</span>
          <input
            name="q"
            type="search"
            placeholder="搜索标题"
            maxLength={100}
          />
        </label>
        <label>
          <span>来源名称</span>
          <input name="source" placeholder="学校、部门或机构" maxLength={100} />
        </label>
        <button className="public-feed-primary">
          <Search size={17} />
          搜索
        </button>
        <button
          type="button"
          aria-label="刷新内容"
          onClick={() => setRevision((r) => r + 1)}
        >
          <RefreshCw size={17} />
        </button>
      </form>
      <div className="public-feed-toolbar">
        <nav className="public-feed-categories" aria-label={title + "分类"}>
          {[{ code: "", label: "全部" }, ...categories].map((c) => (
            <button
              key={c.code}
              aria-pressed={query.category === c.code}
              onClick={() =>
                setQuery({ ...query, category: c.code, offset: 0 })
              }
            >
              {c.label}
              <span className="public-feed-count">
                {data ? (c.code ? data.counts[c.code] || 0 : data.total) : "…"}
              </span>
            </button>
          ))}
        </nav>
        <label className="public-feed-columns">
          每行文章
          <select
            aria-label="每行文章数量"
            value={columns}
            onChange={(e) => {
              const n = Number(e.target.value);
              setColumns(n);
            }}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} 列
              </option>
            ))}
          </select>
        </label>
      </div>
      {!data && !error && (
        <p role="status" className="public-feed-status">
          正在加载…
        </p>
      )}
      {error && (
        <div className="public-feed-status" role="alert">
          <p>{error}</p>
          <button onClick={() => setRevision((r) => r + 1)}>重试</button>
        </div>
      )}
      {data?.items.length === 0 && (
        <p className="public-feed-status">
          {query.q || query.source || query.category
            ? "没有找到匹配内容"
            : "暂无已发布内容"}
        </p>
      )}
      <div className="public-feed-list">
        {data?.items.map((item) => (
          <article className="public-feed-card" key={item.id}>
            <div className="public-feed-meta">
              <span>{item.source.name}</span>
              <span>
                {categories.find(
                  (c) =>
                    c.code ===
                    (surface === "radar"
                      ? item.radarCategory
                      : item.knowledgeCategory),
                )?.label || contentTypeNames[item.contentType]}
              </span>
            </div>
            <h2>
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                {item.title}
              </a>
            </h2>
            {item.summary &&
              item.summary !==
                `关于「${item.title.slice(0, 100)}」的来源信息，请以原文为准。` && (
                <p>{item.summary}</p>
              )}
            <footer>
              <span>
                原文发布：
                {!item.publishedAt
                  ? "时间未知"
                  : item.publishedAt.length === 10
                    ? item.publishedAt
                    : new Date(item.publishedAt).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        hour12: false,
                      })}
              </span>
              <a
                className="text-link"
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                查看原文
                <ArrowUpRight size={16} />
              </a>
            </footer>
          </article>
        ))}
      </div>
      {data && (
        <div className="public-feed-pagination">
          <button
            disabled={!query.offset}
            onClick={() =>
              setQuery({ ...query, offset: Math.max(0, query.offset - 12) })
            }
          >
            上一页
          </button>
          <span>第 {query.offset / 12 + 1} 页</span>
          <button
            disabled={!data.hasMore || query.offset + 12 > 200}
            onClick={() => setQuery({ ...query, offset: query.offset + 12 })}
          >
            下一页
          </button>
        </div>
      )}
    </section>
  );
}
