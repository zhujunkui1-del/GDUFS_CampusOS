"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { accountRequest, useAccount } from "@/features/account/account-context";
import { AccountFrame } from "@/features/account/shared";
import type {
  FavoriteItem,
  FavoriteSurface,
} from "@/lib/server/account/favorites";
import { PublicArticleDialog } from "./public-article-dialog";
import type { PublicArticleSummary } from "./public-feed";
import { useFavorites } from "./favorites-context";
import "./favorites-page.css";

const filters: { value: "all" | FavoriteSurface; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "radar", label: "校园雷达" },
  { value: "knowledge", label: "校园知识" },
  { value: "calendar", label: "活动日历" },
];
const surfaceLabels: Record<FavoriteSurface, string> = {
  radar: "校园雷达",
  knowledge: "校园知识",
  calendar: "活动日历",
};
type FavoriteResult = {
  items: FavoriteItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export function FavoritesPage() {
  const account = useAccount();
  const user = account.session?.user;
  const userId = user?.id || "";
  const favorites = useFavorites();
  const [filter, setFilter] = useState<"all" | FavoriteSurface>("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<FavoriteResult>();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{
    article: PublicArticleSummary;
    surface: FavoriteSurface;
  } | null>(null);
  const [removing, setRemoving] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void (async () => {
      try {
        const data = await accountRequest<FavoriteResult>(
          `/api/me/favorites?surface=${filter}&page=${page}&limit=20`,
          undefined,
          "GET",
        );
        if (!active) return;
        setResult(data);
        setError("");
      } catch (reason) {
        if (!active) return;
        setError(
          reason instanceof Error ? reason.message : "收藏暂时无法加载。",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [filter, page, reload, userId]);

  async function remove(item: FavoriteItem) {
    setRemoving(item.articleId);
    try {
      await favorites.remove(item.articleId);
      setResult((current) =>
        current
          ? {
              ...current,
              items: current.items.filter(
                (entry) => entry.articleId !== item.articleId,
              ),
              total: Math.max(0, current.total - 1),
            }
          : current,
      );
    } catch {
      /* The provider restores the favorite and surfaces the error. */
    } finally {
      setRemoving("");
    }
  }

  const content = !user ? (
    <div className="account-card favorites-empty">
      <Bookmark size={30} aria-hidden="true" />
      <p>登录后可以收藏文章，并在不同设备查看自己的收藏。</p>
      <Link className="account-primary-link" href="/account/login">
        去登录
      </Link>
    </div>
  ) : (
    <>
      <div className="favorites-tabs" role="tablist" aria-label="收藏分类">
        {filters.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={filter === entry.value}
            onClick={() => {
              setFilter(entry.value);
              setPage(1);
              setResult(undefined);
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="favorites-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setError("");
              setReload((value) => value + 1);
            }}
          >
            重试
          </button>
        </div>
      )}

      {!result && !error && (
        <p className="favorites-status">正在加载收藏…</p>
      )}

      {result && !result.items.length && !error && (
        <div className="favorites-empty">
          <Bookmark size={30} aria-hidden="true" />
          <h2>还没有收藏文章</h2>
          <p>在校园雷达、校园知识或活动日历的分享文章上点书签即可收藏。</p>
        </div>
      )}

      {result && result.items.length > 0 && (
        <>
          <div className="favorites-list" aria-live="polite">
            {result.items.map((item) => {
              const article: PublicArticleSummary = {
                id: item.articleId,
                version: item.version,
                title: item.title,
                url: item.url,
                readable: item.readable,
                publishedAt: item.publishedAt,
                contentType: "article",
                knowledgeCategory: null,
                radarCategory: null,
                source: { name: item.sourceName, official: false },
              };
              return (
                <article className="favorites-card" key={item.articleId}>
                  <button
                    type="button"
                    className="favorites-card-open"
                    disabled={!item.available}
                    onClick={() => {
                      if (item.available)
                        setSelected({
                          article,
                          surface: item.originSurface,
                        });
                    }}
                  >
                    <strong>{item.title}</strong>
                    <span className="favorites-card-meta">
                      <span>{item.sourceName}</span>
                      <span>{formatTime(item.publishedAt)}</span>
                    </span>
                    <span className="favorites-card-favorite-time">
                      {surfaceLabels[item.originSurface]} · 收藏于{" "}
                      {formatFavoriteTime(item.createdAt)}
                    </span>
                    {!item.available && (
                      <span className="favorites-card-unavailable">
                        文章当前不可公开阅读
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="favorites-card-remove"
                    aria-label={`取消收藏：${item.title}`}
                    title="取消收藏"
                    disabled={removing === item.articleId}
                    onClick={(event) => {
                      event.stopPropagation();
                      void remove(item);
                    }}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>

          {(result.page > 1 || result.hasMore) && (
            <nav className="favorites-pagination" aria-label="收藏分页">
              <button
                type="button"
                disabled={result.page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft size={17} />
                上一页
              </button>
              <span>
                第 {result.page} / {Math.max(1, Math.ceil(result.total / 20))} 页
              </span>
              <button
                type="button"
                disabled={!result.hasMore}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
                <ChevronRight size={17} />
              </button>
            </nav>
          )}
        </>
      )}
    </>
  );

  return (
    <AccountFrame title="我的收藏" backHref="/account">
      {content}
      {selected && (
        <PublicArticleDialog
          article={selected.article}
          categoryLabel="收藏文章"
          surface={selected.surface}
          onClose={() => setSelected(null)}
        />
      )}
    </AccountFrame>
  );
}

function formatTime(value: string | null) {
  if (!value) return "时间未知";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", "/");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatFavoriteTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
