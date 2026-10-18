"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { knowledgeCategories } from "@/domain/console/taxonomy";
import { useConsoleV2Data } from "./v2-workspace";
type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Row = Record<string, string | number | null>;
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
export function AutoPolicyPanel({
  request,
  sourceId,
  version,
  admin,
  reload,
}: {
  request: Client;
  sourceId: string;
  version: number;
  admin: boolean;
  reload: () => void;
}) {
  const { data, error } = useConsoleV2Data<Row | null>(
    request,
    `v2/sources/${sourceId}/auto-policy`,
  );
  const loading = data === undefined;
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await request(`v2/sources/${sourceId}/auto-policy`, "POST", {
        ...cmd(version),
        enabled: f.get("enabled") === "on",
        rightsScope: f.get("rights"),
        defaultCategory: f.get("category"),
        unknownDate: f.get("unknownDate"),
        allowUnofficial: f.get("unofficial") === "on",
        validityDays: Number(f.get("days")),
        evidenceUrls: String(f.get("evidence")).split(/\s+/).filter(Boolean),
        note: f.get("note"),
      });
      setMessage("来源级政策已保存");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <p role="status">{error || "正在读取政策…"}</p>;
  return (
    <section className="console-card">
      <h2>自动发布政策</h2>
      <form
        className="console-form"
        onSubmit={save}
        key={String(data?.version || 0)}
      >
        <label>
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={!!data?.enabled}
            disabled={!admin}
          />
          授权自动发布
        </label>
        <label>
          发布范围
          <select
            name="rights"
            defaultValue={String(data?.rights_scope || "metadata_only")}
            disabled={!admin}
          >
            <option value="metadata_only">元数据与原文链接</option>
            <option value="excerpt_and_link">许可摘录与链接</option>
            <option value="licensed_full_text">许可全文</option>
          </select>
        </label>
        <label>
          默认知识分类
          <select
            name="category"
            defaultValue={String(
              data?.default_knowledge_category || "campus_life",
            )}
            disabled={!admin}
          >
            {knowledgeCategories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          发布时间未知
          <select
            name="unknownDate"
            defaultValue={String(data?.unknown_date_strategy || "review")}
            disabled={!admin}
          >
            <option value="review">转人工核对</option>
            <option value="metadata_unknown">明确标记未知，仅元数据发布</option>
          </select>
        </label>
        <label>
          有效天数
          <input
            name="days"
            type="number"
            min="1"
            max="30"
            defaultValue="1"
            disabled={!admin}
          />
        </label>
        <label>
          许可证据URL
          <textarea
            name="evidence"
            required
            defaultValue={
              data ? JSON.parse(String(data.evidence_urls_json)).join("\n") : ""
            }
            disabled={!admin}
          />
        </label>
        <label>
          授权说明
          <textarea
            name="note"
            minLength={5}
            required
            defaultValue={String(data?.note || "")}
            disabled={!admin}
          />
        </label>
        <label>
          <input
            type="checkbox"
            name="unofficial"
            defaultChecked={!!data?.allow_unofficial}
            disabled={!admin}
          />
          明确批准非官方来源的元数据发布
        </label>
        <button disabled={!admin || busy}>保存自动发布政策</button>
        <p role="status">{message}</p>
      </form>
    </section>
  );
}
export function ArticleChecks({
  request,
  id,
  admin,
}: {
  request: Client;
  id: string;
  admin: boolean;
}) {
  const state = useConsoleV2Data<{ results: Row[] }>(
      request,
      `v2/checks/${id}`,
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(attest: boolean) {
    setBusy(true);
    try {
      if (attest) {
        const d = await request<{ version: number; url: string }>(
          `content/${id}`,
        );
        await request(`v2/attest/${id}`, "POST", {
          ...cmd(d.version),
          evidenceUrls: [d.url],
          note: "管理员已对照原文核对来源、标题和发布时间",
        });
      }
      const r = await request<{ outcome: string; published: boolean }>(
        `v2/checks/${id}`,
        "POST",
        {},
      );
      setMessage(
        r.published
          ? "已通过门禁并发布"
          : r.outcome === "blocked"
            ? "当前发布受限"
            : "已进入异常审核",
      );
      state.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "检查未完成");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="console-card">
      <h2>完整性检查</h2>
      <Link
        className="text-link"
        href={"/admin/whitelist?type=document&target=" + id}
      >
        保护这篇文章
      </Link>
      <div className="console-actions">
        <button disabled={busy} onClick={() => void run(false)}>
          重新检查
        </button>
        {admin && (
          <button disabled={busy} onClick={() => void run(true)}>
            我已核对原文，重新检查
          </button>
        )}
      </div>
      <p role="status">{message || state.error}</p>
      {state.data?.results.slice(0, 1).map((c) => (
        <div key={String(c.id)}>
          <p>
            {c.outcome === "blocked"
              ? "发布阻断"
              : c.outcome === "review"
                ? "异常待处理"
                : "检查通过"}
          </p>
          <ul>
            {JSON.parse(String(c.issues_json)).map(
              (i: { code: string; message: string }) => (
                <li key={i.code}>{i.message}</li>
              ),
            )}
          </ul>
        </div>
      ))}
    </section>
  );
}
