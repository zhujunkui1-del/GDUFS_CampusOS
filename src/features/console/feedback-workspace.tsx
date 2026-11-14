"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, RefreshCw } from "lucide-react";
import type { FeedbackInbox } from "@/domain/feedback";

export function FeedbackWorkspace({
  request,
}: {
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
}) {
  const [inbox, setInbox] = useState<FeedbackInbox | null>(null);
  const [error, setError] = useState("");
  const [archiving, setArchiving] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const value = await request<FeedbackInbox>("v2/feedback");
      setInbox(value);
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "加载失败，请重试。");
    }
  }, [request]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  async function archive(id: string) {
    setArchiving(id);
    setError("");
    try {
      await request("v2/feedback/" + id + "/archive", "POST");
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "归档失败，请重试。");
    } finally {
      setArchiving(null);
    }
  }
  return (
    <>
      <div className="console-heading">
        <h1>反馈</h1>
        <button type="button" aria-label="刷新反馈" onClick={() => void load()}>
          <RefreshCw size={20} />
        </button>
      </div>
      {error && (
        <p className="console-error" role="alert">
          {error}
        </p>
      )}
      {!inbox ? (
        <p className="console-empty">正在加载…</p>
      ) : (
        (["pending", "archived"] as const).map((status) => (
          <section
            className="console-card feedback-inbox"
            key={status}
            aria-label={status === "pending" ? "待处理" : "已归档"}
          >
            <h2>
              {status === "pending" ? "待处理" : "已归档"}{" "}
              <span>{inbox[status].length}</span>
            </h2>
            {inbox[status].length === 0 && (
              <p className="console-empty">暂无反馈</p>
            )}
            {inbox[status].map((item) => (
              <article className="feedback-inbox-item" key={item.id}>
                <header>
                  <strong>{item.nickname || "匿名"}</strong>
                  <time dateTime={item.submittedAt}>
                    {new Date(item.submittedAt).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                      hour12: false,
                    })}
                  </time>
                </header>
                <p>{item.content}</p>
                {status === "pending" && (
                  <button
                    type="button"
                    disabled={archiving === item.id}
                    onClick={() => void archive(item.id)}
                  >
                    <Archive size={17} />
                    {archiving === item.id ? "归档中…" : "归档"}
                  </button>
                )}
              </article>
            ))}
          </section>
        ))
      )}
    </>
  );
}
