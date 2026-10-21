"use client";
import { useEffect, useState, type ComponentType, type FormEvent } from "react";
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
      <section className="console-card">
        <ConsoleV2Filters
          embedded
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
export { DateGateWorkspace as RetentionWorkspace } from "./date-gate-workspace";
