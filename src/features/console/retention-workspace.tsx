"use client";
import { useState, type ComponentType, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useConsoleV2Data, type ConsoleV2DialogProps } from "./v2-workspace";
type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Row = Record<string, string | number | null>;
type List = { items: Row[]; total: number; limit: number; offset: number };
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
const shown = (v: unknown) =>
  v
    ? new Date(typeof v === "number" ? v : String(v)).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
      })
    : "永久";
export function WhitelistWorkspace({
  request,
  admin,
  Dialog,
}: {
  request: Client;
  admin: boolean;
  Dialog: ComponentType<ConsoleV2DialogProps>;
}) {
  const params = useSearchParams(),
    [type, setType] = useState(params.get("type") || "source"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [status, setStatus] = useState("active"),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<Row[]>([]),
    [remove, setRemove] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const state = useConsoleV2Data<List>(
    request,
    `v2/whitelist?${new URLSearchParams({ q: filter, status, offset: String(offset), limit: "20" })}`,
  );
  const choices = useConsoleV2Data<{
    items: (Row & { version: number; displayName?: string })[];
  }>(
    request,
    type === "source"
      ? `v2/sources?q=${encodeURIComponent(search)}&limit=20`
      : `v2/articles?q=${encodeURIComponent(search)}&limit=20`,
  );
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      id = String(f.get("target")),
      target = choices.data?.items.find((x) => x.id === id);
    if (!target) return;
    setBusy(true);
    try {
      await request("v2/whitelist", "POST", {
        ...cmd(target.version),
        type,
        targetId: id,
        active: true,
        historyExempt: f.get("exempt") === "on",
        expiresAt: f.get("expires")
          ? new Date(String(f.get("expires")) + ":00+08:00").toISOString()
          : null,
        reason: f.get("reason"),
      });
      setMessage("已加入白名单");
      state.reload();
      choices.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  async function removeSelected() {
    setBusy(true);
    const errors = [];
    for (const row of selected)
      try {
        await request("v2/whitelist", "POST", {
          ...cmd(Number(row.target_version)),
          type: row.target_type,
          targetId: row.target_id,
          active: false,
          historyExempt: false,
          expiresAt: null,
          reason: "管理员明确解除白名单保护",
        });
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "操作失败");
      }
    setMessage(errors.length ? errors.join("；") : "已解除保护");
    setBusy(false);
    setRemove(false);
    setSelected([]);
    state.reload();
  }
  return (
    <>
      <div className="console-heading">
        <h1>白名单</h1>
      </div>
      <section className="console-card">
        <div className="console-actions">
          <input
            aria-label="搜索白名单"
            placeholder="来源、文章或保护原因"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setOffset(0);
            }}
          />
          <select
            aria-label="白名单状态"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="active">保护中</option>
            <option value="expired">已到期</option>
            <option value="removed">已移除</option>
          </select>
          <button
            disabled={!admin || !selected.length || busy}
            onClick={() => setRemove(true)}
          >
            移除所选（{selected.length}）
          </button>
        </div>
        <p role="status">{message || state.error}</p>
        <div className="console-v2-list">
          {state.data?.items.map((row) => (
            <article
              className="console-v2-row"
              key={String(row.target_type) + row.target_id}
            >
              <label>
                <input
                  type="checkbox"
                  disabled={
                    !admin || (selected.length >= 5 && !selected.includes(row))
                  }
                  checked={selected.includes(row)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, row]
                        : selected.filter((x) => x !== row),
                    )
                  }
                />
                <strong>{row.title}</strong>
              </label>
              <p>
                {row.target_type === "source" ? "信息源" : "单篇文章"} ·{" "}
                {row.reason}
              </p>
              <p>
                截止：{shown(row.expires_at_ms)} · 保护文章{" "}
                {row.protected_count} ·{" "}
                {row.history_exempt ? "历史导入豁免" : "不豁免导入日期"}
              </p>
              <Link
                className="text-link"
                href={
                  row.target_type === "source"
                    ? `/admin/sources?record=${row.target_id}`
                    : `/admin/sources?article=${row.target_id}`
                }
              >
                查看对象
              </Link>
            </article>
          ))}
        </div>
        {state.data?.total === 0 && <p className="console-empty">暂无记录</p>}
        <div className="console-actions">
          <button
            disabled={!offset}
            onClick={() => {
              setOffset(Math.max(0, offset - 20));
              setSelected([]);
            }}
          >
            上一页
          </button>
          <span>{state.data?.total || 0} 条</span>
          <button
            disabled={offset + 20 >= (state.data?.total || 0)}
            onClick={() => {
              setOffset(offset + 20);
              setSelected([]);
            }}
          >
            下一页
          </button>
        </div>
      </section>
      <details className="console-card" open={!!params.get("target")}>
        <summary>新增保护</summary>
        <form className="console-form" onSubmit={add}>
          <label>
            保护类型
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="source">信息源</option>
              <option value="document">单篇文章</option>
            </select>
          </label>
          <label>
            查找对象
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            选择对象
            <select
              name="target"
              required
              defaultValue={params.get("target") || ""}
            >
              <option value="">请选择</option>
              {choices.data?.items.map((x) => (
                <option key={String(x.id)} value={String(x.id)}>
                  {String(x.displayName || x.title)}
                </option>
              ))}
            </select>
          </label>
          <label>
            保护原因
            <textarea name="reason" required minLength={5} maxLength={500} />
          </label>
          <label>
            截止时间（北京时间，留空为永久）
            <input type="datetime-local" name="expires" />
          </label>
          <label>
            <input name="exempt" type="checkbox" />
            批准历史导入日期豁免
          </label>
          <button disabled={!admin || busy}>添加保护</button>
        </form>
      </details>
      <Dialog
        open={remove}
        onClose={() => setRemove(false)}
        title="解除白名单保护？"
        description={`将解除${selected.length}个对象的保护，不会立即删除内容。`}
        action="解除保护"
        busy={busy}
        confirm={() => void removeSelected()}
      />
    </>
  );
}
type Plan = Row & {
  counts: Row[];
  unknownDate: number;
  purgeAllowed: boolean;
  confirmation: string;
};
const stages: Record<string, string> = {
  previewing: "预览中",
  ready: "预览完成",
  marking: "标记中",
  marked: "已撤销公开可见性",
  purging: "永久清理中",
  paused: "已暂停",
  complete: "已完成",
};
export function RetentionWorkspace({
  request,
  admin,
  Dialog,
}: {
  request: Client;
  admin: boolean;
  Dialog: ComponentType<ConsoleV2DialogProps>;
}) {
  const [id, setId] = useState<string | null>(null),
    [pending, setPending] = useState<"mark" | "purge" | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0),
    [q, setQ] = useState(""),
    [itemOffset, setItemOffset] = useState(0);
  const list = useConsoleV2Data<List>(
      request,
      `v2/retention?offset=${offset}&q=${encodeURIComponent(q)}`,
    ),
    detail = useConsoleV2Data<Plan>(request, id ? `v2/retention/${id}` : null),
    settings = useConsoleV2Data<Row>(request, "v2/settings");
  const p = detail.data;
  const items = useConsoleV2Data<List>(
    request,
    id ? `v2/retention/${id}/items?offset=${itemOffset}` : null,
  );
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      filters: Record<string, string> = { cutoff: String(f.get("cutoff")) };
    for (const key of [
      "sourceId",
      "category",
      "tag",
      "publication",
      "body",
      "q",
    ]) {
      const value = f.get(key);
      if (value) filters[key] = String(value);
    }
    setBusy(true);
    try {
      const r = await request<{ id: string }>("v2/retention", "POST", {
        commandId: crypto.randomUUID(),
        filters,
      });
      setId(r.id);
      list.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "预览失败");
    } finally {
      setBusy(false);
    }
  }
  async function action(a: string) {
    if (!id || !p) return;
    setBusy(true);
    try {
      await request(`v2/retention/${id}`, "POST", {
        ...cmd(Number(p.version)),
        action: a,
        ...(a === "mark" || a === "purge"
          ? { confirmation: (a === "purge" ? "永久" : "") + p.confirmation }
          : {}),
      });
      detail.reload();
      items.reload();
      list.reload();
      setPending(null);
      setMessage("步骤已完成，请查看进度");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  async function saveCutoff(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!settings.data) return;
    const f = new FormData(e.currentTarget),
      s = settings.data;
    setBusy(true);
    try {
      await request("v2/settings", "POST", {
        ...cmd(Number(s.version)),
        syncHours: s.sync_hours,
        autoSync: !!s.auto_sync_enabled,
        networkBudget: s.network_budget,
        earliestImportDay: f.get("earliest") || null,
        confirmImportCutoff: f.get("confirm") === "on",
        note: "管理员明确调整最早允许导入发布日期",
      });
      settings.reload();
      setMessage("导入日期门禁已保存");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="console-heading">
        <h1>过时信息清理</h1>
      </div>
      <p role="status">{message || detail.error || list.error}</p>
      <section className="console-card">
        <h2>最早允许导入发布日期</h2>
        {settings.data && (
          <form
            key={Number(settings.data.version)}
            className="console-form"
            onSubmit={saveCutoff}
          >
            <label>
              北京时间日期
              <input
                name="earliest"
                type="date"
                defaultValue={String(settings.data.earliest_import_day || "")}
              />
            </label>
            <label>
              <input type="checkbox" name="confirm" required />
              确认新门禁仅约束后续导入，不删除现有内容
            </label>
            <button disabled={!admin || busy}>保存导入日期门禁</button>
          </form>
        )}
      </section>
      <details className="console-card" open={!id}>
        <summary>预览清理结果</summary>
        <form className="console-form" onSubmit={create}>
          <label>
            截止日期（不含当天，北京时间）
            <input required name="cutoff" type="date" />
          </label>
          <label>
            来源ID
            <input name="sourceId" />
          </label>
          <label>
            标题
            <input name="q" />
          </label>
          <label>
            分类代码
            <input name="category" />
          </label>
          <label>
            主题标签
            <input name="tag" />
          </label>
          <label>
            发布状态
            <select name="publication">
              <option value="">全部</option>
              <option value="draft">未发布</option>
              <option value="published">已发布</option>
              <option value="withdrawn">已撤回</option>
            </select>
          </label>
          <label>
            正文状态
            <select name="body">
              <option value="">全部</option>
              <option value="complete">完整</option>
              <option value="partial">部分</option>
              <option value="not_provided">仅元数据</option>
              <option value="unknown">未知</option>
            </select>
          </label>
          <button disabled={!admin || busy}>创建只读清理预览</button>
        </form>
      </details>
      {p && (
        <section className="console-card">
          <h2>{stages[String(p.state)]}</h2>
          <p>
            已检查 {p.scanned} 篇；日期未知 {p.unknownDate} 篇（不按旧文删除）
          </p>
          <p>
            范围内逻辑数据 {(Number(p.logical_bytes) / 1024).toFixed(1)}{" "}
            KiB；D1实际释放量暂无指标
          </p>
          <ul>
            {p.counts.map((c, i) => (
              <li key={i}>
                {
                  (
                    {
                      candidate: "符合清理条件",
                      protected: "白名单保护",
                      valid: "仍有效/日期边界排除",
                      dependency: "业务引用阻止",
                      changed: "已变化",
                    } as Record<string, string>
                  )[String(c.classification)]
                }{" "}
                · {c.stage}：{c.n}
              </li>
            ))}
          </ul>
          <div className="console-v2-list">
            {items.data?.items.map((i) => (
              <article className="console-v2-row" key={String(i.document_id)}>
                <Link
                  className="text-link"
                  href={"/admin/sources?article=" + i.document_id}
                >
                  {i.title}
                </Link>
                <p>
                  {i.published_at} · {i.classification} · {i.stage}
                </p>
                {i.error && <p>{i.error}</p>}
              </article>
            ))}
          </div>
          <div className="console-actions">
            <button
              disabled={!itemOffset}
              onClick={() => setItemOffset(Math.max(0, itemOffset - 20))}
            >
              上一组对象
            </button>
            <span>{items.data?.total || 0} 篇</span>
            <button
              disabled={itemOffset + 20 >= (items.data?.total || 0)}
              onClick={() => setItemOffset(itemOffset + 20)}
            >
              下一组对象
            </button>
          </div>
          <div className="console-actions">
            {p.state === "previewing" && (
              <button
                disabled={!admin || busy}
                onClick={() => void action("scan")}
              >
                继续预览（最多5篇）
              </button>
            )}
            {["ready", "marking"].includes(String(p.state)) && (
              <button
                disabled={!admin || busy}
                onClick={() => setPending("mark")}
              >
                确认批量标记
              </button>
            )}
            {["marked", "purging"].includes(String(p.state)) && (
              <button
                className="danger-button"
                disabled={!admin || busy || !p.purgeAllowed}
                onClick={() => setPending("purge")}
              >
                永久清理（分批）
              </button>
            )}
            {!p.purgeAllowed && <span>当前环境永久清理未授权</span>}
            {["previewing", "marking", "purging"].includes(String(p.state)) && (
              <button
                disabled={!admin || busy}
                onClick={() => void action("pause")}
              >
                暂停计划
              </button>
            )}
            {p.state === "paused" && (
              <button
                disabled={!admin || busy}
                onClick={() => void action("resume")}
              >
                恢复计划
              </button>
            )}
          </div>
        </section>
      )}
      <section className="console-card">
        <h2>清理记录</h2>
        <input
          aria-label="搜索清理计划"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        {list.data?.items.map((x) => (
          <article className="console-v2-row" key={String(x.id)}>
            <button className="text-link" onClick={() => setId(String(x.id))}>
              {String(x.created_at)} · {stages[String(x.state)]}
            </button>
            <p>检查 {x.scanned} 篇</p>
          </article>
        ))}
        {list.data?.total === 0 && (
          <p className="console-empty">暂无清理记录</p>
        )}
        <div className="console-actions">
          <button
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            上一页
          </button>
          <span>{list.data?.total || 0} 项</span>
          <button
            disabled={offset + 20 >= (list.data?.total || 0)}
            onClick={() => setOffset(offset + 20)}
          >
            下一页
          </button>
        </div>
      </section>
      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={
          pending === "purge" ? "永久清理这些内容？" : "标记可清理的内容？"
        }
        description={
          pending === "purge"
            ? "将永久清除预览范围内无保护、无业务引用的正文与大对象。保留审计、许可记录和防重复导入墓碑，此操作无法恢复。"
            : `已检查${p?.scanned || 0}篇。仅标记符合条件的对象并撤销公开可见性，白名单和业务引用会再次核对。`
        }
        action={pending === "purge" ? "确认永久清理" : "确认标记"}
        busy={busy}
        confirm={() => pending && void action(pending)}
      />
    </>
  );
}
