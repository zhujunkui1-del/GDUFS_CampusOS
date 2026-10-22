"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Source = {
  source_id: string;
  account_id: string;
  display_name: string;
  enabled: number;
  since_day: string;
  interval_minutes: number;
  article_count: number;
  removed_count: number;
  last_observed_at: string | null;
};
type Token = {
  id: string;
  label: string;
  source_count: number;
  last_seen_at: string | null;
  revoked_at: string | null;
  expires_at_ms: number;
};
type Data = {
  sources: Source[];
  tokens: Token[];
  heartbeats: {
    label: string;
    status: string;
    mode: string;
    last_seen_at: string;
    last_error: string | null;
  }[];
};
export function CollectorPanel({ request }: { request: Client }) {
  const [data, setData] = useState<Data | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [disconnect, setDisconnect] = useState<string | null>(null);
  function receive(d: Data) {
    setData(d);
  }
  const load = () =>
    request<Data>("collector")
      .then(receive)
      .catch((e) => setMessage(e.message));
  useEffect(() => {
    let live = true;
    void request<Data>("collector")
      .then((d) => {
        if (live) {
          setData(d);
        }
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      });
    return () => {
      live = false;
    };
  }, [request]);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      setMessage(success);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="console-heading">
        <h1>公众号采集</h1>
        <button disabled={busy} onClick={() => void load()}>
          刷新
        </button>
      </div>
      <section className="console-card">
        <h2>自动同步</h2>
        <p>MP Tools 下载完成后，每分钟自动同步并发布。</p>
        {data?.heartbeats.length ? (
          data.heartbeats.map((h) => (
            <p key={h.label}>
              {h.label} ·{" "}
              {{
                idle: "等待新内容",
                syncing: "同步中",
                blocked: "本地连接需要处理",
                error: "同步异常",
              }[h.status] || h.status}{" "}
              ·{" "}
              <strong>
                最近在线{" "}
                {new Date(h.last_seen_at).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                  hour12: false,
                })}
              </strong>
              {h.last_error ? " · " + h.last_error : ""}
            </p>
          ))
        ) : (
          <p>尚未连接。请在本机启动 CampusOS 同步。</p>
        )}
      </section>
      <details className="console-card">
        <summary>使用方法</summary>
        <ol>
          <li>
            打开本机 WeChat MP Tools，在“公众号管理”选择账号并进入“文章”。
          </li>
          <li>设置所需日期范围，点击“按时间下载”，等待下载成功。</li>
          <li>双击本机“启动 CampusOS 同步.cmd”，保持电脑运行。</li>
          <li>约一分钟后刷新本页；点击下方公众号查看已发布文章。</li>
        </ol>
        <p>文章门禁统一在“过时信息清理”设置；下载日期在 MP Tools 中设置。</p>
      </details>
      <details className="console-card">
        <summary>连接状态</summary>
        {data?.tokens
          .filter((t) => !t.revoked_at)
          .map((t) => (
            <p key={t.id}>
              {t.source_count} 个来源 ·{" "}
              {t.expires_at_ms === 0
                ? "长期有效（可撤销）"
                : new Date(t.expires_at_ms).toLocaleDateString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  }) + " 到期"}
              {disconnect === t.id ? (
                <span className="console-actions">
                  <button
                    className="console-danger-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await request(
                          "collector/credentials/" + t.id,
                          "POST",
                          {},
                        );
                        setDisconnect(null);
                      }, "本机连接已撤销；已发布文章仍可阅读。")
                    }
                  >
                    确认撤销连接
                  </button>
                  <button disabled={busy} onClick={() => setDisconnect(null)}>
                    取消
                  </button>
                </span>
              ) : (
                <button disabled={busy} onClick={() => setDisconnect(t.id)}>
                  撤销连接
                </button>
              )}
            </p>
          ))}
      </details>
      {message && (
        <p className="console-feedback" role="status">
          {message}
        </p>
      )}
      <div className="console-card console-list">
        {data?.sources.map((s) => (
          <Link
            className="console-source-row"
            key={s.source_id}
            href={"/admin/sources?record=" + s.source_id}
          >
            <div>
              <strong>{s.display_name}</strong>
              <span>
                {s.account_id} · {s.since_day} 起
              </span>
            </div>
            <span>
              {s.enabled ? "启用" : "暂停"} ·{" "}
              {s.article_count - s.removed_count} 篇 · 下架 {s.removed_count}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
