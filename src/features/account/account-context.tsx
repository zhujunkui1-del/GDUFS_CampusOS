"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AccountProfile } from "@/domain/account/contracts";
type Session = {
  available: boolean;
  user: AccountProfile | null;
  mailAvailable: boolean;
  expiresAt?: number | null;
};
type Value = {
  session: Session | null;
  loading: boolean;
  error: string;
  refresh(): Promise<Session | null>;
  changed(kind?: "identity" | "profile"): Promise<Session | null>;
};
const Context = createContext<Value | null>(null);
const eventKey = "campusos:account-revision";
export async function accountRequest<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error("网络异常，请重试。");
  }
  const value = await response.json();
  if (!response.ok || !value.ok)
    throw new Error(value.error?.message || "操作未完成，请稍后重试。");
  return value.data as T;
}
export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const generation = useRef(0),
    lastUser = useRef<string | null | undefined>(undefined);
  const clearIdentity = useCallback(() => {
    lastUser.current = null;
    setSession((s) => (s ? { ...s, user: null } : s));
    window.dispatchEvent(new Event("campusos:identity-changed"));
  }, []);
  const refresh = useCallback(async () => {
    const g = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const data = await accountRequest<Session>(
        "/api/auth/session",
        undefined,
        "GET",
      );
      if (g !== generation.current) return null;
      if (
        lastUser.current !== undefined &&
        lastUser.current !== (data.user?.id || null)
      ) {
        window.dispatchEvent(new Event("campusos:identity-changed"));
      }
      lastUser.current = data.user?.id || null;
      setSession(data);
      return data;
    } catch (e) {
      if (g === generation.current)
        setError(e instanceof Error ? e.message : "账号状态暂不可用。");
      return null;
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }, []);
  const changed = useCallback(
    async (kind: "identity" | "profile" = "profile") => {
      if (kind === "identity") clearIdentity();
      try {
        localStorage.setItem(
          eventKey,
          JSON.stringify({ kind, at: crypto.randomUUID() }),
        );
      } catch {}
      return refresh();
    },
    [clearIdentity, refresh],
  );
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const focus = () => {
      void refresh();
    };
    const storage = (e: StorageEvent) => {
      if (e.key !== eventKey) return;
      try {
        if (JSON.parse(e.newValue || "{}").kind === "identity") clearIdentity();
      } catch {}
      void refresh();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("storage", storage);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("focus", focus);
      window.removeEventListener("storage", storage);
    };
  }, [refresh, clearIdentity]);
  return (
    <Context.Provider
      value={{
        session,
        loading,
        error,
        refresh,
        changed,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAccount() {
  const value = useContext(Context);
  if (!value) throw Error("Account context unavailable");
  return value;
}
