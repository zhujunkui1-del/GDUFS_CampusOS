"use client";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState, useRef, useMemo } from "react";
import { readingDocument } from "@/domain/console/reading-document";
import "./article-reader.css";
type Article = {
  id: string;
  title: string;
  url: string;
  readingHtml: string;
  partial: boolean;
  publishedAt: string;
  updatedAt: string;
  sourceName: string;
};
export function ArticleReader({ id }: { id: string }) {
  const router = useRouter();
  function goBack() {
    // Navigation entries identify the actual preceding page after SPA transitions.
    const navigation = (
      window as Window & {
        navigation?: {
          currentEntry?: { index: number };
          entries(): { url?: string }[];
        };
      }
    ).navigation;
    const previous =
      navigation?.entries()[(navigation.currentEntry?.index ?? 0) - 1]?.url;
    const referrer = previous || document.referrer;
    if (
      window.history.length > 1 &&
      referrer &&
      new URL(referrer, location.origin).origin === location.origin
    ) {
      router.back();
    } else {
      router.replace("/radar");
    }
  }
  const [state, setState] = useState<{
    id: string;
    article?: Article;
    error?: string;
  }>({ id: "" });
  useEffect(() => {
    const abort = new AbortController();
    const load = () =>
      fetch("/api/public/article?id=" + encodeURIComponent(id), {
        cache: "no-store",
        signal: abort.signal,
      })
        .then(async (r) => {
          const b = await r.json();
          if (!r.ok || !b.ok)
            throw Error(b.error?.message || "文章暂时无法读取。");
          return b.data as Article;
        })
        .then((article) => {
          if (!abort.signal.aborted) setState({ id, article });
        })
        .catch((e) => {
          if (!abort.signal.aborted)
            setState({
              id,
              error: e instanceof Error ? e.message : "文章暂时无法读取。",
            });
        });
    void load();
    // Recheck when returning to an open tab so removed bodies do not remain displayed.
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      abort.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [id]);
  const article = state.id === id ? state.article : undefined;
  return (
    <section className="module-page article-reader">
      <button className="article-back" onClick={goBack}>
        <ArrowLeft size={18} aria-hidden="true" />
        返回
      </button>
      {state.id === id && state.error ? (
        <p role="alert">{state.error}</p>
      ) : !article ? (
        <p role="status">正在加载文章…</p>
      ) : (
        <article>
          <header>
            <p className="article-source">{article.sourceName}</p>
            <h1>{article.title}</h1>
            <p className="article-date">
              原文发布：
              {new Date(article.publishedAt).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
                hour12: false,
              })}
            </p>
            <a href={article.url} target="_blank" rel="noopener noreferrer">
              查看原文 ↗
            </a>
          </header>
          <ReadingFrame html={article.readingHtml} title={article.title} />
          <footer>
            <a href={article.url} target="_blank" rel="noopener noreferrer">
              查看原文 ↗
            </a>
          </footer>
        </article>
      )}
    </section>
  );
}

export function ReadingFrame({ html, title }: { html: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null),
    cleanup = useRef<(() => void) | null>(null);
  const [height, setHeight] = useState(600),
    document = useMemo(() => readingDocument(html), [html]);
  useEffect(() => () => cleanup.current?.(), []);
  function loaded() {
    cleanup.current?.();
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    let pending = 0;
    const resize = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        const size = Math.max(
          240,
          Math.min(250000, Math.ceil(doc.body.getBoundingClientRect().height)),
        );
        setHeight((h) => (Math.abs(h - size) > 1 ? size : h));
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(doc.body);
    doc.addEventListener("load", resize, true);
    cleanup.current = () => {
      observer.disconnect();
      doc.removeEventListener("load", resize, true);
      cancelAnimationFrame(pending);
    };
    resize();
  }
  return (
    <iframe
      ref={frame}
      className="article-reading-frame"
      title={title + " 正文"}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={document}
      onLoad={loaded}
      style={{ height }}
    />
  );
}
