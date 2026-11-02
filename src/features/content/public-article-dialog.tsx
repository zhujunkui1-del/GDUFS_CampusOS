"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { ReadingFrame } from "./article-reader";
import type { PublicArticleSummary } from "./public-feed";
import type { FavoriteSurface } from "@/lib/server/account/favorites";
import { RegistrationBadge } from "./registration-badge";
import { FavoriteButton } from "./favorite-button";
import "./public-article-dialog.css";

type ArticleDetail = {
  id: string;
  title: string;
  url: string;
  readingHtml: string;
  partial: boolean;
  publishedAt: string | null;
  updatedAt: string;
  sourceName: string;
};

export function PublicArticleDialog({
  article,
  categoryLabel,
  surface,
  onClose,
}: {
  article: PublicArticleSummary;
  categoryLabel: string;
  surface: FavoriteSurface;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<{
    id: string;
    detail?: ArticleDetail;
    error?: string;
  }>({ id: "" });

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);

  useEffect(() => {
    if (!article.readable) return;
    const abort = new AbortController();
    fetch("/api/public/article?id=" + encodeURIComponent(article.id), {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.ok)
          throw Error(body.error?.message || "文章暂时无法读取。");
        return body.data as ArticleDetail;
      })
      .then((detail) => {
        if (!abort.signal.aborted) setState({ id: article.id, detail });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setState({
            id: article.id,
            error:
              error instanceof Error ? error.message : "文章暂时无法读取。",
          });
      });
    return () => abort.abort();
  }, [article.id, article.readable]);

  const detail = state.id === article.id ? state.detail : undefined;
  const error = state.id === article.id ? state.error : undefined;

  return (
    <dialog
      ref={dialog}
      className="public-article-dialog"
      aria-labelledby="public-article-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="public-article-dialog-panel">
        <div className="public-article-dialog-toolbar">
          <span className="public-article-category">{categoryLabel}</span>
          <div className="public-article-dialog-actions">
            <FavoriteButton articleId={article.id} surface={surface} />
            <a
              className="public-article-original"
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              查看原文
              <ArrowUpRight size={17} aria-hidden="true" />
            </a>
            <button
              className="public-article-close"
              type="button"
              aria-label="关闭文章详情"
              title="关闭"
              onClick={onClose}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="public-article-dialog-content">
          <header className="public-article-heading">
            <h2 id="public-article-title">
              <RegistrationBadge
                show={article.hasRegistration}
                category={article.radarCategory || article.knowledgeCategory}
              />
              {article.title}
            </h2>
            <div className="public-article-meta">
              <span>
                发布时间：
                {formatDetailTime(article.publishedAt)}
              </span>
              <span className="public-article-source">
                {article.source.name}
              </span>
            </div>
          </header>

          <section className="public-article-body">
            <h3>正文</h3>
            {error ? (
              <p role="alert" className="public-article-message">
                {error}
              </p>
            ) : !article.readable ? (
              <p className="public-article-message">
                站内暂未提供正文，请查看原文。
              </p>
            ) : detail ? (
              <ReadingFrame html={detail.readingHtml} title={article.title} />
            ) : (
              <p role="status" className="public-article-message">
                正在加载文章…
              </p>
            )}
          </section>
        </div>
      </div>
    </dialog>
  );
}

function formatDetailTime(value: string | null) {
  if (!value) return "时间未知";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", "/");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
