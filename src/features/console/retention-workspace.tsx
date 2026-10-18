"use client";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { sourceTypeNames } from "@/domain/console/contracts";
import {
  knowledgeCategories,
  radarCategories,
} from "@/domain/console/taxonomy";
import {
  useConsoleV2Data,
  ConsoleV2Filters,
  type ConsoleV2DialogProps,
} from "./v2-workspace";
type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Row = Record<string, string | number | null>;
type List = { items: Row[]; total: number; limit: number; offset: number };
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
export function WhitelistWorkspace({
  request,
  admin,
}: {
  request: Client;
  admin: boolean;
  Dialog: ComponentType<ConsoleV2DialogProps>;
}) {
  const params = useSearchParams();
  const [type, setType] = useState(
    params.get("type") === "document" ? "document" : "source",
  );
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [choiceOffset, setChoiceOffset] = useState(0);
  const [picked, setPicked] = useState<Row[] | null>(null),
    [selected, setSelected] = useState<Row[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({}),
    [offset, setOffset] = useState(0);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setChoiceOffset(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const state = useConsoleV2Data<List>(
    request,
    `v2/whitelist?${new URLSearchParams({ ...filters, status: "active", offset: String(offset), limit: "20" })}`,
  );
  const choices = useConsoleV2Data<List>(
    request,
    (type === "source" ? "v2/sources?" : "v2/articles?titleOnly=1&") +
      new URLSearchParams({
        q: query,
        limit: "20",
        offset: String(choiceOffset),
      }),
  );
  const target = params.get("target"),
    targetType = params.get("type") || "source";
  const preselected = useConsoleV2Data<Row>(
    request,
    target && targetType === type
      ? (type === "source" ? "v2/sources/" : "content/") +
          encodeURIComponent(target)
      : null,
  );
  const targets = search.trim() === query ? choices.data?.items || [] : [];
  const pending =
    picked !== null
      ? picked
      : preselected.data && !search
        ? [preselected.data]
        : [];
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pending.length || busy) return;
    setBusy(true);
    let done = 0;
    const failed: Row[] = [];
    try {
      for (let i = 0; i < pending.length; i += 5) {
        const chunk = pending.slice(i, i + 5);
        const result = await request<{
          items: { ok: boolean; error?: string }[];
        }>(
          "v2/whitelist/batch",
          "POST",
          chunk.map((t) => ({
            ...cmd(Number(t.version)),
            type,
            targetId: String(t.id),
            active: true,
          })),
        );
        result.items.forEach((r, j) => {
          if (r.ok) done++;
          else failed.push(chunk[j]);
        });
      }
      setPicked(failed);
      setMessage(
        `已加入${done}项` +
          (failed.length ? `，${failed.length}项失败，请刷新后重试` : ""),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
      state.reload();
      choices.reload();
    }
  }
  async function removeSelected() {
    if (busy) return;
    setBusy(true);
    let done = 0;
    const failed: Row[] = [];
    try {
      for (let i = 0; i < selected.length; i += 5) {
        const chunk = selected.slice(i, i + 5);
        const result = await request<{ items: { ok: boolean }[] }>(
          "v2/whitelist/batch",
          "POST",
          chunk.map((r) => ({
            ...cmd(Number(r.target_version)),
            type: r.target_type,
            targetId: r.target_id,
            active: false,
          })),
        );
        result.items.forEach((r, j) => {
          if (r.ok) done++;
          else failed.push(chunk[j]);
        });
      }
      setSelected(failed);
      setMessage(
        `已移除${done}项` +
          (failed.length ? `，${failed.length}项失败，请刷新后重试` : ""),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "移除失败");
    } finally {
      setBusy(false);
      state.reload();
      choices.reload();
    }
  }
  const key = (r: Row) => String(r.target_type) + r.target_id;
  return (
    <>
      <div className="console-heading">
        <h1>白名单</h1>
      </div>
      <ConsoleV2Filters
        fields={[
          { name: "q", label: "搜索白名单" },
          {
            name: "type",
            label: "白名单类型",
            options: [
              ["source", "信息源"],
              ["document", "单篇文章"],
            ],
          },
          {
            name: "sourceType",
            label: "来源载体",
            options: Object.entries(sourceTypeNames),
          },
          {
            name: "category",
            label: "内容分类",
            options: [...knowledgeCategories, ...radarCategories].map((c) => [
              c.code,
              c.label,
            ]),
          },
          { name: "addedAfter", label: "添加起日", type: "date" },
          {
            name: "sort",
            label: "排序",
            options: [
              ["updated", "添加时间"],
              ["title", "名称"],
            ],
          },
          {
            name: "direction",
            label: "顺序",
            options: [
              ["desc", "倒序"],
              ["asc", "正序"],
            ],
          },
        ]}
        values={filters}
        onChange={(v) => {
          setFilters(v);
          setOffset(0);
          setSelected([]);
        }}
      />
      <section className="console-card">
        <p role="status">{message || state.error}</p>
        <div className="console-v2-list">
          {state.data?.items.map((row) => (
            <article className="console-whitelist-row" key={key(row)}>
              <div>
                <strong>{row.title}</strong>
                <p>
                  {row.target_type === "source" ? "信息源" : "单篇文章"} ·
                  永久保护 · 保护文章 {row.protected_count}
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
              </div>
              <label>
                <input
                  type="checkbox"
                  aria-label={"选择" + row.title}
                  disabled={!admin || busy}
                  checked={selected.some((r) => key(r) === key(row))}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, row]
                        : selected.filter((r) => key(r) !== key(row)),
                    )
                  }
                />
              </label>
            </article>
          ))}
        </div>
        {state.data?.total === 0 && <p className="console-empty">暂无记录</p>}
        <div className="console-actions console-whitelist-footer">
          <button
            disabled={!offset || busy}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            上一页
          </button>
          <span>{state.data?.total || 0} 条</span>
          <button
            disabled={busy || offset + 20 >= (state.data?.total || 0)}
            onClick={() => setOffset(offset + 20)}
          >
            下一页
          </button>
          <button
            disabled={!admin || !selected.length || busy}
            onClick={() => void removeSelected()}
          >
            移除所选（{selected.length}）
          </button>
        </div>
      </section>
      <details className="console-card" open={!!target}>
        <summary>加入白名单</summary>
        <form className="console-form" onSubmit={add}>
          <label>
            保护类型
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPicked([]);
                setSearch("");
                setChoiceOffset(0);
              }}
            >
              <option value="source">信息源</option>
              <option value="document">单篇文章</option>
            </select>
          </label>
          <div className="console-target-picker console-wide">
            <label>
              搜索并选择对象
              <input
                aria-label="搜索并选择对象"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  type === "source" ? "按来源名称搜索" : "按文章标题搜索"
                }
              />
            </label>
            {pending.length > 0 && (
              <div className="console-actions">
                <span>已选 {pending.length} 项</span>
                <button
                  type="button"
                  onClick={() => {
                    setPicked([]);
                    setSearch("");
                  }}
                >
                  清空选择
                </button>
              </div>
            )}
            <div className="console-target-results">
              {targets.map((row) => (
                <label className="console-target-option" key={String(row.id)}>
                  <span>
                    {row.displayName || row.title}
                    <small>
                      {type === "source"
                        ? sourceTypeNames[
                            String(
                              row.sourceType,
                            ) as keyof typeof sourceTypeNames
                          ]
                        : row.source_name}
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    aria-label={"选择对象" + (row.displayName || row.title)}
                    checked={pending.some((r) => r.id === row.id)}
                    disabled={!admin || busy}
                    onChange={(e) =>
                      setPicked(
                        e.target.checked
                          ? [...pending, row]
                          : pending.filter((r) => r.id !== row.id),
                      )
                    }
                  />
                </label>
              ))}
            </div>
            {!targets.length && (
              <p className="console-empty">
                {choices.error ||
                  (choices.data && search.trim() === query
                    ? "没有匹配对象"
                    : "正在查找…")}
              </p>
            )}
            <div className="console-actions">
              <button
                type="button"
                disabled={!choiceOffset}
                onClick={() => setChoiceOffset(Math.max(0, choiceOffset - 20))}
              >
                上一页
              </button>
              <span>{choices.data?.total || 0} 项</span>
              <button
                type="button"
                disabled={choiceOffset + 20 >= (choices.data?.total || 0)}
                onClick={() => setChoiceOffset(choiceOffset + 20)}
              >
                下一页
              </button>
            </div>
          </div>
          <button
            className="primary-button"
            disabled={!admin || busy || !pending.length}
          >
            加入白名单
          </button>
        </form>
      </details>
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
    [itemOffset, setItemOffset] = useState(0),
    [runtimePlan, setRuntimePlan] = useState<Plan>();
  const advancing = useRef(false),
    pauseRequested = useRef(false);
  useEffect(
    () => () => {
      advancing.current = false;
      pauseRequested.current = true;
    },
    [],
  );
  const list = useConsoleV2Data<List>(
      request,
      `v2/retention?offset=${offset}&q=${encodeURIComponent(q)}`,
    ),
    detail = useConsoleV2Data<Plan>(request, id ? `v2/retention/${id}` : null),
    settings = useConsoleV2Data<Row>(request, "v2/settings");
  const p = runtimePlan?.id === id ? runtimePlan : detail.data;
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
      setRuntimePlan(undefined);
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
    setPending(null);
    pauseRequested.current = false;
    advancing.current = ["scan", "mark", "purge"].includes(a);
    let current = p;
    try {
      do {
        if (
          pauseRequested.current &&
          ["previewing", "marking", "purging"].includes(String(current.state))
        ) {
          await request(`v2/retention/${id}`, "POST", {
            ...cmd(Number(current.version)),
            action: "pause",
          });
          current = await request<Plan>(`v2/retention/${id}`);
          setRuntimePlan(current);
          break;
        }
        await request(`v2/retention/${id}`, "POST", {
          ...cmd(Number(current.version)),
          action: a,
          ...(["mark", "purge"].includes(a)
            ? {
                confirmation:
                  (a === "purge" ? "永久" : "") + current.confirmation,
              }
            : {}),
        });
        current = await request<Plan>(`v2/retention/${id}`);
        setRuntimePlan(current);
        if (
          pauseRequested.current &&
          ["previewing", "marking", "purging"].includes(String(current.state))
        ) {
          await request(`v2/retention/${id}`, "POST", {
            ...cmd(Number(current.version)),
            action: "pause",
          });
          current = await request<Plan>(`v2/retention/${id}`);
          setRuntimePlan(current);
          break;
        }
        const continuation =
          a === "scan"
            ? current.state === "previewing"
            : a === "mark"
              ? current.state === "marking"
              : a === "purge"
                ? current.state === "purging"
                : false;
        if (!continuation || !advancing.current) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } while (advancing.current);
      setMessage(
        current.state === "paused" ? "已暂停并保存断点" : "当前阶段已完成",
      );
      detail.reload();
      items.reload();
      list.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "步骤未完成，可安全重试。");
      setRuntimePlan(undefined);
      detail.reload();
      items.reload();
    } finally {
      advancing.current = false;
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
        confirmImportCutoff: true,
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
      {busy && (
        <div className="console-actions">
          <span>保持此页开启以推进分批任务</span>
          <button
            onClick={() => {
              pauseRequested.current = true;
            }}
          >
            暂停推进并保存断点
          </button>
        </div>
      )}
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
            <button className="primary-button" disabled={!admin || busy}>
              保存导入日期门禁
            </button>
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
          <button className="primary-button" disabled={!admin || busy}>
            创建只读清理预览
          </button>
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
            <button
              className="text-link"
              onClick={() => {
                setRuntimePlan(undefined);
                setId(String(x.id));
              }}
            >
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
