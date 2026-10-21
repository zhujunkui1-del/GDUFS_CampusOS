"use client";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
} from "react";
import { safeExternalUrl } from "@/domain/console/contracts";
import { useConsoleV2Data, type ConsoleV2DialogProps } from "./v2-workspace";
type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Row = Record<string, string | number | null>;
type Plan = Row & {
  items: Row[];
  total: number;
  candidates: number;
  protected_count: number;
  cleaned_count: number;
  skipped_count: number;
  offset: number;
};
const command = (p: Plan, action: string) => ({
  commandId: crypto.randomUUID(),
  expectedVersion: Number(p.version),
  action,
});
const date = (value: unknown) =>
  !value
    ? "—"
    : String(value).length === 10
      ? String(value)
      : new Date(String(value)).toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour12: false,
        });
function Articles({
  plan,
  changePage,
}: {
  plan: Plan;
  changePage: (offset: number) => void;
}) {
  return (
    <>
      <div className="console-v2-list">
        {plan.items.map((item) => (
          <article
            className="console-date-gate-row"
            key={String(item.document_id)}
          >
            <strong>{item.title}</strong>
            <p>
              {date(item.published_at)} · {item.source_name}
            </p>
            {safeExternalUrl(String(item.url)) && (
              <a
                className="text-link"
                href={String(item.url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                查看原文 ↗
              </a>
            )}
            <span>
              {item.classification === "protected"
                ? "白名单保留"
                : item.stage === "complete"
                  ? "已清理"
                  : item.stage === "blocked"
                    ? "已变化，跳过"
                    : "待清理"}
            </span>
          </article>
        ))}
      </div>
      {Number(plan.total) === 0 && <p>此日期以前没有待清理文章。</p>}
      <div className="console-actions">
        <button
          disabled={!plan.offset}
          onClick={() => changePage(Math.max(0, plan.offset - 20))}
        >
          上一页
        </button>
        <span>{plan.total} 篇</span>
        <button
          disabled={plan.offset + 20 >= Number(plan.total)}
          onClick={() => changePage(plan.offset + 20)}
        >
          下一页
        </button>
      </div>
    </>
  );
}
export function DateGateWorkspace({
  request,
  admin,
}: {
  request: Client;
  admin: boolean;
  Dialog: ComponentType<ConsoleV2DialogProps>;
}) {
  const settings = useConsoleV2Data<Row>(request, "v2/date-gate");
  const [offset, setOffset] = useState(0),
    [preview, setPreview] = useState<Plan>(),
    [detail, setDetail] = useState<Plan>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const history = useConsoleV2Data<{ items: Row[]; total: number }>(
    request,
    "v2/date-gate/history?offset=" + offset,
  );
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      setPreview(
        await request<Plan>("v2/date-gate", "POST", {
          commandId: crypto.randomUUID(),
          cutoff: new FormData(e.currentTarget).get("cutoff"),
        }),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "预览失败");
    } finally {
      setBusy(false);
    }
  }
  async function page(p: Plan, next: number, target: "preview" | "history") {
    try {
      const result = await request<Plan>(
        "v2/date-gate/" + p.id + "?offset=" + next,
      );
      if (target === "preview") setPreview(result);
      else setDetail(result);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "加载失败");
    }
  }
  async function cancel(p: Plan) {
    setBusy(true);
    try {
      await request("v2/date-gate/" + p.id, "POST", command(p, "cancel"));
      setPreview(undefined);
      setMessage("已取消，门禁时间未改变。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "取消失败");
    } finally {
      setBusy(false);
    }
  }
  async function clean(p: Plan, confirm: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    let current = p;
    try {
      if (confirm)
        current = await request<Plan>(
          "v2/date-gate/" + p.id,
          "POST",
          command(p, "confirm"),
        );
      setPreview(current);
      settings.reload();
      while (active.current && current.state === "purging") {
        current = await request<Plan>(
          "v2/date-gate/" + p.id,
          "POST",
          command(current, "clean"),
        );
        if (!active.current) break;
        setPreview(current);
        if (current.state === "purging")
          await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      if (active.current)
        setMessage(
          current.state === "complete"
            ? `门禁已生效，清理 ${current.cleaned_count || 0} 篇，跳过 ${current.skipped_count || 0} 篇。`
            : "清理进度已保存，可在清理记录中继续。",
        );
    } catch (e) {
      if (active.current)
        setMessage(e instanceof Error ? e.message : "清理中断，可从记录继续。");
    } finally {
      if (active.current) {
        setBusy(false);
        history.reload();
        settings.reload();
      }
    }
  }
  return (
    <>
      <div className="console-heading">
        <h1>过时信息清理</h1>
      </div>
      {message && (
        <p className="console-feedback" role="status">
          {message}
        </p>
      )}
      <section className="console-card">
        <h2>文章日期门禁</h2>
        <p>
          当前门禁：{date(settings.data?.earliest_import_day)} ·
          保留当天及以后的文章
        </p>
        <form className="console-form" onSubmit={create}>
          <label>
            门禁日期（北京时间）
            <input
              key={String(settings.data?.version)}
              type="date"
              name="cutoff"
              required
              defaultValue={String(settings.data?.earliest_import_day || "")}
              disabled={!admin || busy || !settings.data}
              onChange={() => setPreview(undefined)}
            />
          </label>
          <div className="console-actions">
            <button disabled={!admin || busy || !settings.data}>
              预览清理文章
            </button>
          </div>
        </form>
        {settings.error && <p role="alert">{settings.error}</p>}
        {preview && (
          <div className="console-date-gate-preview">
            <h3>{preview.confirmed_at ? "清理进度" : "确认前预览"}</h3>
            <p>
              门禁日期：{JSON.parse(String(preview.filters_json)).cutoff} ·
              将清理 {preview.candidates || 0} 篇 · 白名单保留{" "}
              {preview.protected_count || 0} 篇
            </p>
            {preview.confirmed_at && (
              <p role="status">
                已清理 {preview.cleaned_count || 0} 篇 ·{" "}
                {preview.state === "complete" ? "已完成" : "清理中"}
              </p>
            )}
            <Articles
              plan={preview}
              changePage={(next) => void page(preview, next, "preview")}
            />
            {!preview.confirmed_at && (
              <div className="console-actions">
                <button
                  className="console-danger-button"
                  disabled={!admin || busy}
                  onClick={() => void clean(preview, true)}
                >
                  确认门禁时间
                </button>
                <button disabled={busy} onClick={() => void cancel(preview)}>
                  取消
                </button>
              </div>
            )}
          </div>
        )}
      </section>
      <section className="console-card">
        <h2>清理记录</h2>
        {history.error && <p role="alert">{history.error}</p>}
        {history.data?.items.length === 0 && <p>暂无清理记录</p>}
        {history.data?.items.map((row) => (
          <article className="console-date-gate-row" key={String(row.id)}>
            <strong>
              {date(row.confirmed_at)} · 清理 {row.cleaned_count || 0} 篇
            </strong>
            <p>
              清理前门禁：{date(row.previous_cutoff)} · 本次门禁：
              {JSON.parse(String(row.filters_json)).cutoff}
            </p>
            <div className="console-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void request<Plan>("v2/date-gate/" + row.id)
                    .then(setDetail)
                    .catch((e) => setMessage(e.message))
                }
              >
                查看详情
              </button>
              {row.mode === "date_gate" && row.state === "purging" && (
                <button
                  disabled={!admin || busy}
                  onClick={() =>
                    void request<Plan>("v2/date-gate/" + row.id)
                      .then((p) => clean(p, false))
                      .catch((e) => setMessage(e.message))
                  }
                >
                  继续清理
                </button>
              )}
            </div>
          </article>
        ))}
        {detail && (
          <div className="console-date-gate-preview">
            <h3>清理详情 · 已清理 {detail.cleaned_count || 0} 篇</h3>
            <Articles
              plan={detail}
              changePage={(next) => void page(detail, next, "history")}
            />
            <button onClick={() => setDetail(undefined)}>收起详情</button>
          </div>
        )}
        <div className="console-actions">
          <button
            disabled={!offset || busy}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            上一页
          </button>
          <span>{history.data?.total || 0} 次</span>
          <button
            disabled={busy || offset + 20 >= (history.data?.total || 0)}
            onClick={() => setOffset(offset + 20)}
          >
            下一页
          </button>
        </div>
      </section>
    </>
  );
}
