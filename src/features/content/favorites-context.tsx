"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { accountRequest, useAccount } from "@/features/account/account-context";
import type { FavoriteSurface } from "@/lib/server/account/favorites";

type FavoritesValue = {
  ids: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  error: string;
  track(articleIds: readonly string[]): void;
  toggle(articleId: string, surface: FavoriteSurface): Promise<void>;
  remove(articleId: string): Promise<void>;
};

const Context = createContext<FavoritesValue | null>(null);
const revisionKey = "campusos:favorites-revision";

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const userKey = account.session?.user?.id || "guest";
  return (
    <FavoritesSession key={userKey} signedIn={Boolean(account.session?.user)}>
      {children}
    </FavoritesSession>
  );
}

function FavoritesSession({
  children,
  signedIn,
}: {
  children: ReactNode;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const tracked = useRef(new Set<string>());
  const known = useRef(new Set<string>());
  const mutating = useRef(new Set<string>());
  const mutated = useRef(new Set<string>());
  const timer = useRef<number | undefined>(undefined);
  const generation = useRef(0);

  const flush = useCallback(async () => {
    const all = [...tracked.current].filter(
      (articleId) => !mutating.current.has(articleId),
    );
    if (!all.length) return;
    const generationAtStart = generation.current;
    for (let index = 0; index < all.length; index += 100) {
      const articleIds = all.slice(index, index + 100);
      try {
        const data = await accountRequest<{ favorited: string[] }>(
          "/api/me/favorites/status",
          { articleIds },
        );
        if (generationAtStart !== generation.current) return;
        const favorited = new Set(data.favorited);
        setIds((current) => {
          const next = new Set(current);
          for (const id of articleIds) {
            known.current.add(id);
            if (mutated.current.has(id)) continue;
            if (favorited.has(id)) next.add(id);
            else next.delete(id);
          }
          return next;
        });
      } catch {
        /* Reading remains available when favorite status fails. */
      }
    }
  }, []);

  const track = useCallback(
    (articleIds: readonly string[]) => {
      let changed = false;
      for (const id of articleIds) {
        if (!id || tracked.current.has(id)) continue;
        tracked.current.add(id);
        changed = true;
      }
      if (!changed) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 30);
    },
    [flush],
  );

  const toggle = useCallback(
    async (articleId: string, surface: FavoriteSurface) => {
      if (!signedIn) {
        router.push("/account/login");
        return;
      }
      if (pending.has(articleId)) return;
      const wasFavorite = ids.has(articleId);
      generation.current += 1;
      mutating.current.add(articleId);
      mutated.current.add(articleId);
      setError("");
      setPending((current) => new Set(current).add(articleId));
      setIds((current) => {
        const next = new Set(current);
        if (wasFavorite) next.delete(articleId);
        else next.add(articleId);
        return next;
      });
      known.current.add(articleId);
      try {
        await accountRequest(
          "/api/me/favorites/" + encodeURIComponent(articleId),
          wasFavorite ? undefined : { originSurface: surface },
          wasFavorite ? "DELETE" : "PUT",
        );
        try {
          localStorage.setItem(
            revisionKey,
            JSON.stringify({ id: articleId, at: Date.now() }),
          );
        } catch {}
      } catch (reason) {
        setIds((current) => {
          const next = new Set(current);
          if (wasFavorite) next.add(articleId);
          else next.delete(articleId);
          return next;
        });
        setError(
          reason instanceof Error ? reason.message : "收藏操作未完成，请重试。",
        );
      } finally {
        mutating.current.delete(articleId);
        setPending((current) => {
          const next = new Set(current);
          next.delete(articleId);
          return next;
        });
      }
    },
    [ids, pending, router, signedIn],
  );

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== revisionKey) return;
      known.current = new Set();
      void flush();
    };
    const focus = () => void flush();
    window.addEventListener("storage", sync);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", focus);
      window.clearTimeout(timer.current);
    };
  }, [flush]);

  const remove = useCallback(
    async (articleId: string) => {
      if (pending.has(articleId)) return;
      generation.current += 1;
      mutating.current.add(articleId);
      mutated.current.add(articleId);
      setError("");
      setPending((current) => new Set(current).add(articleId));
      setIds((current) => {
        const next = new Set(current);
        next.delete(articleId);
        return next;
      });
      known.current.add(articleId);
      try {
        await accountRequest(
          "/api/me/favorites/" + encodeURIComponent(articleId),
          undefined,
          "DELETE",
        );
        try {
          localStorage.setItem(
            revisionKey,
            JSON.stringify({ id: articleId, at: Date.now() }),
          );
        } catch {}
      } catch (reason) {
        setIds((current) => new Set(current).add(articleId));
        setError(
          reason instanceof Error ? reason.message : "取消收藏未完成，请重试。",
        );
        throw reason;
      } finally {
        mutating.current.delete(articleId);
        setPending((current) => {
          const next = new Set(current);
          next.delete(articleId);
          return next;
        });
      }
    },
    [pending],
  );

  return (
    <Context.Provider value={{ ids, pending, error, track, toggle, remove }}>
      {children}
    </Context.Provider>
  );
}

export function useFavorites() {
  const value = useContext(Context);
  if (!value) throw Error("Favorites context unavailable");
  return value;
}

export function useFavoriteStatus(
  articleId: string,
  surface: FavoriteSurface,
) {
  const favorites = useFavorites();
  useEffect(() => {
    favorites.track([articleId]);
  }, [articleId, favorites]);
  return {
    favorite: favorites.ids.has(articleId),
    pending: favorites.pending.has(articleId),
    error: favorites.error,
    toggle: () => favorites.toggle(articleId, surface),
  };
}

export function useFavoriteTracking(articleIds: readonly string[]) {
  const favorites = useFavorites();
  const key = articleIds.join("\u0000");
  useEffect(() => {
    favorites.track(articleIds);
  }, [favorites, key, articleIds]);
}
