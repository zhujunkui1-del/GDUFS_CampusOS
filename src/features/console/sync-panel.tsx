"use client";
import { useState, type FormEvent } from "react";
import { useConsoleV2Data } from "./v2-workspace";
type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Row = Record<string, string | number | null>;
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
export function SourceCollectionPolicy({
  request,
  id,
  version,
  admin,
  reload,
}: {
  request: Client;
  id: string;
  version: number;
  admin: boolean;
  reload: () => void;
}) {
  const state = useConsoleV2Data<{
      profile: { ruleVersion: string; origin: string };
      policy: Row | null;
    }>(request, `sources/${id}/collection-policy`),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  if (state.error) return <p role="status">此来源需人工导入</p>;
  if (!state.data) return <p role="status">正在读取同步许可…</p>;
  const data = state.data;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await request(`sources/${id}/collection-policy`, "POST", {
        ...cmd(version),
        ruleVersion: data.profile.ruleVersion,
        rightsScope: f.get("rights"),
        evidenceUrls: String(f.get("evidence")).split(/\s+/).filter(Boolean),
        note: f.get("note"),
        fullTextAuthorized: f.get("full") === "on",
        validityDays: Number(f.get("days")),
        robotsStatus: Number(f.get("robots")),
        robotsHash: null,
      });
      setMessage("来源级同步许可已保存");
      reload();
      state.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="console-card">
      <summary>同步访问许可</summary>
      <a
        className="text-link"
        href={data.profile.origin + "/robots.txt"}
        target="_blank"
        rel="noopener noreferrer"
      >
        查看访问规则
      </a>
      <form className="console-form" onSubmit={save}>
        <label>
          许可范围
          <select
            name="rights"
            defaultValue={String(data.policy?.rights_scope || "metadata_only")}
          >
            <option value="metadata_only">公开元数据</option>
            <option value="excerpt_and_link">已许可摘录</option>
            <option value="licensed_full_text">已许可全文</option>
          </select>
        </label>
        <label>
          已核对的robots结果
          <select name="robots" required defaultValue="">
            <option value="">请选择核对结果</option>
            <option value="200">存在，允许本栏目访问</option>
            <option value="404">不存在，另按适用规则核对</option>
          </select>
        </label>
        <label>
          许可证据URL
          <textarea name="evidence" required />
        </label>
        <label>
          许可说明
          <textarea name="note" minLength={5} required />
        </label>
        <label>
          有效天数
          <input name="days" type="number" min="1" max="30" defaultValue="1" />
        </label>
        <label>
          <input type="checkbox" name="full" />
          已获得所选正文用途许可
        </label>
        <button disabled={!admin || busy}>保存同步许可</button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}
export function RunnerTokens({
  request,
  admin,
}: {
  request: Client;
  admin: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!admin) return null;
  return (
    <details
      className="console-card"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>执行器授权</summary>
      {open && <RunnerTokenBody request={request} admin={admin} />}
    </details>
  );
}
function RunnerTokenBody({
  request,
  admin,
}: {
  request: Client;
  admin: boolean;
}) {
  const state = useConsoleV2Data<{ items: Row[]; adminVersion: number }>(
      request,
      admin ? "v2/runner-tokens" : null,
    ),
    [token, setToken] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  if (!admin) return null;
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!state.data) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await request<{ token: string | null }>(
        "v2/runner-tokens",
        "POST",
        {
          ...cmd(state.data.adminVersion),
          label: f.get("label"),
          sourceIds: String(f.get("sources")).split(/\s+/).filter(Boolean),
          validityDays: Number(f.get("days")),
        },
      );
      setToken(r.token || "");
      setMessage("执行器授权已建立；凭据只显示一次");
      state.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "授权失败");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (!state.data) return;
    setBusy(true);
    try {
      await request(
        "v2/runner-tokens/" + id,
        "POST",
        cmd(state.data.adminVersion),
      );
      setMessage("授权已撤销");
      state.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "撤销失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <p role="status">{message || state.error}</p>
      {token && (
        <div className="console-actions">
          <input
            aria-label="一次性执行器凭据"
            type="password"
            value={token}
            readOnly
            autoComplete="off"
          />
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(token)
                .then(() => setMessage("已复制；请保存在本机私密文件"))
            }
          >
            复制凭据
          </button>
          <button onClick={() => setToken("")}>隐藏并清除</button>
        </div>
      )}
      <form className="console-form" onSubmit={create}>
        <label>
          执行器名称
          <input name="label" minLength={2} maxLength={80} required />
        </label>
        <label>
          允许来源ID（每行一个）
          <textarea name="sources" required />
        </label>
        <label>
          有效天数
          <input
            name="days"
            type="number"
            min="1"
            max="30"
            defaultValue="1"
            required
          />
        </label>
        <button disabled={busy}>创建受限执行器授权</button>
      </form>
      {state.data?.items.map((t) => (
        <article className="console-v2-row" key={String(t.id)}>
          <strong>{t.label}</strong>
          <p>
            {t.revoked_at_ms ? "已撤销" : !!t.active ? "有效" : "已到期"} ·{" "}
            {t.last_seen_at ? "最近在线 " + t.last_seen_at : "未连接"}
          </p>
          <button
            disabled={busy || !!t.revoked_at_ms}
            onClick={() => void revoke(String(t.id))}
          >
            撤销执行器授权
          </button>
        </article>
      ))}
    </div>
  );
}
