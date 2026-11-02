"use client";
import { Bookmark } from "lucide-react";
import { useFavoriteStatus } from "./favorites-context";
import type { FavoriteSurface } from "@/lib/server/account/favorites";
import "./favorites.css";

export function FavoriteButton({
  articleId,
  surface,
  className = "",
}: {
  articleId: string;
  surface: FavoriteSurface;
  className?: string;
}) {
  const { favorite, pending, error, toggle } = useFavoriteStatus(
    articleId,
    surface,
  );
  return (
    <button
      type="button"
      className={`favorite-button ${favorite ? "is-favorite" : ""} ${className}`.trim()}
      aria-pressed={favorite}
      aria-label={favorite ? "取消收藏" : "收藏文章"}
      title={error || (favorite ? "取消收藏" : "收藏文章")}
      disabled={pending}
      data-favorite={favorite ? "true" : "false"}
      data-article-id={articleId}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggle();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Bookmark
        size={18}
        strokeWidth={1.8}
        fill={favorite ? "currentColor" : "none"}
        aria-hidden="true"
      />
    </button>
  );
}
