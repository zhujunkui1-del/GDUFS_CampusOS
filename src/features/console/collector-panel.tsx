"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
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
    [sinceDay, setSinceDay] = useState("");
  function receive(d: Data) {
    setData(d);
    const days = new Set(d.sources.map((s) => s.since_day));
    setSinceDay(days.size === 1 ? d.sources[0].since_day : "");
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
          const days = new Set(d.sources.map((s) => s.since_day));
          setSinceDay(days.size === 1 ? d.sources[0].since_day : "");
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
  const ids = data?.sources.map((s) => s.source_id) || [];
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(
      () =>
        request("collector/range", "POST", {
          sourceIds: ids,
          sinceDay: f.get("sinceDay"),
        }),
      "已保存。新起日仅约束后续导入，不会批量删除已有文章。",
    );
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
      <section className="console-card">
        <h2>文章起日</h2>
        <p>统一应用到 {data?.sources.length || 0} 个公众号。</p>
        <form className="console-form" onSubmit={save}>
          <label>
            文章起日（北京时间）
            <input
              type="date"
              name="sinceDay"
              value={sinceDay}
              onChange={(e) => setSinceDay(e.target.value)}
              required
            />
          </label>
          <div className="console-actions console-wide">
            <button disabled={busy || !ids.length}>保存文章起日</button>
          </div>
        </form>
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
        <p>
          本页的文章起日仅筛选导入文件，不会启动或改变 MP Tools 的下载任务。
        </p>
      </details>
      <details className="console-card">
        <summary>连接状态</summary>
        {data?.tokens
          .filter((t) => !t.revoked_at)
          .map((t) => (
            <p key={t.id}>
              {t.source_count} 个来源 ·{" "}
              {new Date(t.expires_at_ms).toLocaleDateString("zh-CN", {
                timeZone: "Asia/Shanghai",
              })}{" "}
              到期
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
