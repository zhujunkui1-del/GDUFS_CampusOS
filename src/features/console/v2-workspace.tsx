"use client";
import { articlePublicationNames } from "@/domain/console/article-publication";
import { WhitelistWorkspace, RetentionWorkspace } from "./retention-workspace";
import { CollectorPanel } from "./collector-panel";
import { OfficialWebCollectionPanel } from "./official-web-collection-panel";
import { TrafficPanel, SourceSessionPanel } from "./dashboard-panels";
import { FeedbackWorkspace } from "./feedback-workspace";
import Link from "next/link";
import {
  useEffect,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, ArrowLeft, RefreshCw } from "lucide-react";
import {
  sourceTypeNames,
  safeExternalUrl,
  type ConsoleActor,
  type SourceDetail,
  type SourceInput,
} from "@/domain/console/contracts";
import type { SourceV2 } from "@/domain/console/v2";
import {
  knowledgeCategories,
  radarCategories,
  contentTypeNames,
  topicNames,
} from "@/domain/console/taxonomy";
type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type List<T> = { items: T[]; total: number; limit: number; offset: number };
export type ConsoleV2DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  action: string;
  busy: boolean;
  confirm: () => void;
};
type WorkspaceProps = {
  section: string;
  id: string | null;
  request: Client;
  actor: ConsoleActor;
  Dialog: ComponentType<ConsoleV2DialogProps>;
  article: (id: string) => ReactNode;
  jobs: (sourceId?: string) => ReactNode;
  history: (sourceId?: string) => ReactNode;
  advancedSource: (id: string) => ReactNode;
  manualImport: () => ReactNode;
};
const cmd = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
const date = (v: unknown) =>
  !v
    ? "—"
    : String(v).length === 10
      ? String(v)
      : new Date(typeof v === "number" ? v : String(v)).toLocaleString(
          "zh-CN",
          { timeZone: "Asia/Shanghai", hour12: false },
        );
export function useConsoleV2Data<T>(request: Client, path: string | null) {
  const [state, setState] = useState<{
    path: string;
    revision: number;
    data?: T;
    error?: string;
  }>({ path: "", revision: -1 });
  const [revision, refresh] = useState(0);
  useEffect(() => {
    if (!path) return;
    let active = true;
    request<T>(path)
      .then((data) => {
        if (active) setState({ path, revision, data });
      })
      .catch((e) => {
        if (active)
          setState({
            path,
            revision,
            error: e.message || "加载失败，请重试。",
          });
      });
    return () => {
      active = false;
    };
  }, [request, path, revision]);
  return {
    data:
      state.path === path && state.revision === revision
        ? state.data
        : undefined,
    error: state.path === path ? state.error : undefined,
    reload: () => refresh((v) => v + 1),
  };
}
function Feedback({ message }: { message?: string }) {
  return message ? (
    <p className="console-feedback" role="status">
      {message}
    </p>
  ) : null;
}
function Loading({ error }: { error?: string }) {
  return (
    <p className="console-empty" role={error ? "alert" : "status"}>
      {error || "正在加载…"}
    </p>
  );
}
export type ConsoleFilter = {
  name: string;
  label: string;
  type?: "text" | "date" | "number";
  options?: [string, string][];
};
export function ConsoleV2Filters({
  fields,
  values,
  onChange,
  embedded = false,
}: {
  fields: ConsoleFilter[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  embedded?: boolean;
}) {
  return (
    <details
      className={
        embedded ? "console-v2-filters" : "console-card console-v2-filters"
      }
    >
      <summary>筛选与排序</summary>
      <form
        key={JSON.stringify(values)}
        className="console-form"
        onSubmit={(e) => {
          e.preventDefault();
          const values = Object.fromEntries(
            [...new FormData(e.currentTarget)]
              .map(([k, v]) => [k, String(v)])
              .filter(([, v]) => v),
          );
          if (values.sort?.includes(":")) {
            const [sort, direction] = values.sort.split(":");
            values.sort = sort;
            values.direction = direction;
          }
          onChange(values);
        }}
      >
        {fields
          .filter(
            (f) => !["direction", "campus", "organization"].includes(f.name),
          )
          .map((f) => (
            <label key={f.name}>
              {f.label}
              {f.name === "sort" && f.options ? (
                <select
                  name="sort"
                  defaultValue={
                    (values.sort || f.options[0][0]) +
                    ":" +
                    (values.direction || "desc")
                  }
                >
                  {f.options.flatMap(([value, label]) =>
                    (["desc", "asc"] as const).map((direction) => (
                      <option
                        key={value + direction}
                        value={value + ":" + direction}
                      >
                        {sortLabel(value, label, direction)}
                      </option>
                    )),
                  )}
                </select>
              ) : f.options ? (
                <select name={f.name} defaultValue={values[f.name] || ""}>
                  <option value="">全部</option>
                  {f.options.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={f.name}
                  type={f.type || "text"}
                  defaultValue={values[f.name] || ""}
                  maxLength={100}
                />
              )}
            </label>
          ))}
        <div className="console-actions console-wide">
          <button className="primary-button">应用筛选</button>
          <button type="button" onClick={() => onChange({})}>
            重置
          </button>
        </div>
      </form>
    </details>
  );
}
function sortLabel(value: string, label: string, direction: "asc" | "desc") {
  if (value === "articles")
    return "文章数量" + (direction === "asc" ? "升序" : "降序");
  if (value === "next_sync")
    return label + (direction === "asc" ? "（从早到晚）" : "（从晚到早）");
  if (/时间|更新|发布/.test(label))
    return label + (direction === "asc" ? "（从旧到新）" : "（从新到旧）");
  return label + (direction === "asc" ? "升序" : "降序");
}
export function ConsoleV2Pages({
  data,
  onPage,
}: {
  data: { total: number; offset: number; limit: number };
  onPage: (n: number) => void;
}) {
  return (
    <div className="console-pagination">
      <span>
        {data.total} 条 · 第 {Math.floor(data.offset / data.limit) + 1} 页
      </span>
      <button
        disabled={!data.offset}
        onClick={() => onPage(Math.max(0, data.offset - data.limit))}
      >
        上一页
      </button>
      <button
        disabled={data.offset + data.limit >= data.total}
        onClick={() => onPage(data.offset + data.limit)}
      >
        下一页
      </button>
    </div>
  );
}
const sourceFilters: ConsoleFilter[] = [
  { name: "q", label: "搜索信息源" },
  { name: "type", label: "载体", options: Object.entries(sourceTypeNames) },
  {
    name: "state",
    label: "启用状态",
    options: [
      ["enabled", "启用"],
      ["closed", "停运"],
    ],
  },
  { name: "updatedAfter", label: "更新起日", type: "date" },
  { name: "updatedBefore", label: "更新止日", type: "date" },
  {
    name: "sort",
    label: "排序",
    options: [
      ["updated", "最近更新"],
      ["name", "名称"],
      ["articles", "文章数量"],
    ],
  },
];
export const articleFilters: ConsoleFilter[] = [
  { name: "q", label: "搜索文章" },
  {
    name: "type",
    label: "内容类型",
    options: Object.entries(contentTypeNames),
  },
  {
    name: "category",
    label: "正式分类",
    options: [...radarCategories, ...knowledgeCategories].map((c) => [
      c.code,
      c.label,
    ]),
  },
  { name: "tag", label: "辅助主题", options: topicNames.map((t) => [t, t]) },
  {
    name: "state",
    label: "状态",
    options: [
      ["published", "已发布"],
      ["pending", "未发布"],
    ],
  },
  { name: "publishedAfter", label: "发布起日", type: "date" },
  {
    name: "sort",
    label: "排序",
    options: [
      ["updated", "最近更新"],
      ["published", "发布时间"],
      ["title", "标题"],
    ],
  },
];
export function ConsoleV2Articles({
  request,
  sourceId,
  exceptions = false,
  canReview = false,
}: {
  request: Client;
  sourceId?: string;
  exceptions?: boolean;
  canReview?: boolean;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({}),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<
      Record<string, string | number | null>[]
    >([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const query = new URLSearchParams({
    ...filters,
    offset: String(offset),
    ...(sourceId ? { sourceId } : {}),
  });
  const { data, error, reload } = useConsoleV2Data<
    List<Record<string, string | number | null>>
  >(request, "v2/articles?" + query);
  async function batch(action: "publish" | "withdraw") {
    setBusy(true);
    let done = 0;
    const errors = [];
    for (const d of selected)
      try {
        await request(
          "content/" + d.id + "/" + action,
          "POST",
          cmd(Number(d.version)),
        );
        done++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "处理失败");
      }
    setMessage(
      `已处理${done}篇` + (errors.length ? "；" + errors.join("；") : ""),
    );
    setSelected([]);
    setBusy(false);
    reload();
  }
  return (
    <>
      <ConsoleV2Filters
        fields={articleFilters}
        values={filters}
        onChange={(v) => {
          setFilters(v);
          setOffset(0);
          setSelected([]);
        }}
      />
      {exceptions && canReview && (
        <div className="console-card console-actions">
          <button
            className="primary-button"
            disabled={busy || !selected.length}
            onClick={() => void batch("publish")}
          >
            批量发布
          </button>
          <button
            disabled={busy || !selected.length}
            onClick={() => void batch("withdraw")}
          >
            批量撤回
          </button>
          <span>已选 {selected.length} 篇</span>
          <p role="status">{message}</p>
        </div>
      )}
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="console-card console-list">
            {data.items.length ? (
              data.items.map((d) => (
                <div key={String(d.id)} className="console-v2-select-row">
                  {exceptions && canReview && (
                    <input
                      type="checkbox"
                      aria-label={"选择" + d.title}
                      checked={selected.some((s) => s.id === d.id)}
                      disabled={busy}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, d]
                            : selected.filter((s) => s.id !== d.id),
                        )
                      }
                    />
                  )}
                  <Link
                    className="console-source-row"
                    key={String(d.id)}
                    href={`/admin/sources?record=${encodeURIComponent(String(d.source_id))}&article=${encodeURIComponent(String(d.id))}`}
                  >
                    <div>
                      <strong>{d.title}</strong>
                      <span>
                        {d.source_name} · {date(d.published_at)}
                      </span>
                    </div>
                    <span>
                      {
                        articlePublicationNames[
                          d.publication_state === "published"
                            ? "published"
                            : "pending"
                        ]
                      }
                    </span>
                  </Link>
                </div>
              ))
            ) : (
              <p className="console-empty">
                {exceptions ? "暂无待处理异常。" : "暂无文章。"}
              </p>
            )}
          </div>
          <ConsoleV2Pages data={data} onPage={setOffset} />
        </>
      )}
    </>
  );
}
function Sources({
  request,
  actor,
}: {
  request: Client;
  actor: ConsoleActor;
  Dialog: WorkspaceProps["Dialog"];
}) {
  const [filters, setFilters] = useState<Record<string, string>>({}),
    [offset, setOffset] = useState(0),
    [selection, setSelection] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const { data, error, reload } = useConsoleV2Data<List<SourceV2>>(
    request,
    "v2/sources?" + new URLSearchParams({ ...filters, offset: String(offset) }),
  );
  async function bulk(action: string) {
    if (!data) return;
    setBusy(true);
    try {
      const r = await request<{ items: { ok: boolean; error?: string }[] }>(
        "v2/sources/batch",
        "POST",
        {
          action,
          items: data.items
            .filter((s) => selection.includes(s.id))
            .map((s) => ({
              id: s.id,
              version: s.version,
              commandId: crypto.randomUUID(),
            })),
        },
      );
      setMessage(
        `完成 ${r.items.filter((i) => i.ok).length} 项${r.items.some((i) => !i.ok) ? "；" + r.items.find((i) => !i.ok)?.error : ""}`,
      );
      setSelection([]);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="console-heading">
        <h1>信息源</h1>
        {actor.role !== "reviewer" && (
          <Link className="primary-button" href="/admin/sources?record=new">
            <Plus size={17} />
            添加信息源
          </Link>
        )}
      </div>
      <ConsoleV2Filters
        fields={sourceFilters}
        values={filters}
        onChange={(v) => {
          setFilters(v);
          setOffset(0);
          setSelection([]);
        }}
      />
      <Feedback message={message} />
      {selection.length > 0 && (
        <div className="console-card console-actions">
          <strong>已选 {selection.length} 项</strong>
          <button disabled={busy} onClick={() => void bulk("enable")}>
            批量启用
          </button>
          <button disabled={busy} onClick={() => void bulk("pause")}>
            批量停运
          </button>
          <button disabled={busy} onClick={() => void bulk("archive")}>
            批量删除
          </button>
        </div>
      )}
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="console-card console-v2-source-list">
            {data.items.length ? (
              data.items.map((s) => (
                <article key={s.id} className="console-v2-source">
                  <label className="console-select-row">
                    <input
                      aria-label={`选择${s.displayName}`}
                      type="checkbox"
                      disabled={
                        actor.role === "reviewer" ||
                        (!selection.includes(s.id) && selection.length >= 5)
                      }
                      checked={selection.includes(s.id)}
                      onChange={(e) =>
                        setSelection(
                          e.target.checked
                            ? [...selection, s.id]
                            : selection.filter((id) => id !== s.id),
                        )
                      }
                    />
                  </label>
                  <Link
                    className="console-v2-source-link"
                    href={"/admin/sources?record=" + encodeURIComponent(s.id)}
                  >
                    <h2>{s.displayName}</h2>
                    <p>
                      {s.organization || "机构待补充"} ·{" "}
                      {sourceTypeNames[s.sourceType]}
                    </p>
                    <div className="console-v2-source-status">
                      <span
                        className={
                          "console-badge " +
                          (s.enabled
                            ? "console-status-approved"
                            : "console-status-pending")
                        }
                      >
                        {s.enabled ? "启用" : "停运"}
                      </span>
                      {s.collectorEnabled != null && (
                        <span>
                          {s.collectorEnabled && s.enabled
                            ? "公众号文章库"
                            : "公众号未启用"}
                        </span>
                      )}
                      {s.protected && <span>白名单保护</span>}
                    </div>
                  </Link>
                  <div
                    className="console-v2-source-counts"
                    aria-label="文章数量"
                  >
                    <span>
                      <strong>{s.articleCount}</strong>
                      <small>文章</small>
                    </span>
                    <span>
                      <strong>{s.publishedCount}</strong>
                      <small>已发布</small>
                    </span>
                  </div>
                </article>
              ))
            ) : (
              <p className="console-empty">没有符合条件的信息源。</p>
            )}
          </div>
          <ConsoleV2Pages data={data} onPage={setOffset} />
        </>
      )}
    </>
  );
}
function SourceForm({
  request,
  id,
  onSaved,
  extra,
}: {
  request: Client;
  id?: string;
  onSaved: (id: string) => void;
  extra?: SourceV2;
}) {
  const { data, error } = useConsoleV2Data<SourceDetail>(
    request,
    id ? "sources/" + id : null,
  );
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [carrier, setCarrier] = useState<string | null>(null),
    [similar, setSimilar] = useState<SourceV2[]>([]);
  if (id && !data) return <Loading error={error} />;
  const initial = id ? data : undefined;
  const currentCarrier = carrier || initial?.sourceType || "official_web";
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      type = String(f.get("sourceType")),
      links = (name: string) =>
        String(f.get(name) || "")
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean);
    const input: SourceInput = {
      displayName: String(f.get("displayName")),
      sourceType: type as SourceInput["sourceType"],
      sourceAliases: initial?.sourceAliases || [],
      subtype: initial?.subtype || "",
      organization: String(f.get("organization") || ""),
      websiteUrl: String(f.get("websiteUrl") || "") || null,
      wechatId: String(f.get("wechatId") || "") || null,
      campusScope: "all",
      evidenceUrls: links("evidence"),
      priority: initial?.priority || 3,
      connectorType: initial?.connectorType || "disabled",
      connectorConfig: initial?.connectorConfig || {},
      fetchPolicy: initial?.fetchPolicy || { mode: "disabled", maxRequests: 0 },
    };
    setBusy(true);
    try {
      const r = await request<{ id: string }>(
        id ? "sources/" + id : "v2/sources",
        id ? "PATCH" : "POST",
        {
          ...input,
          ...(id ? cmd(initial!.version) : { commandId: crypto.randomUUID() }),
          ...{
            miniProgramId: String(f.get("miniProgramId") || "") || null,
            sourceNote: String(f.get("sourceNote") || ""),
          },
        },
      );
      setMessage("已保存");
      onSaved(r.id);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="console-card console-form" onSubmit={save}>
      <Feedback message={message} />
      <label>
        名称
        <input
          name="displayName"
          required
          maxLength={200}
          defaultValue={initial?.displayName}
          onBlur={(e) => {
            if (!id && e.target.value.trim().length > 1)
              void request<List<SourceV2>>(
                "v2/sources?limit=5&q=" +
                  encodeURIComponent(e.target.value.trim()),
              )
                .then((r) => setSimilar(r.items))
                .catch(() => setSimilar([]));
          }}
        />
      </label>
      <label>
        载体
        <select
          name="sourceType"
          defaultValue={initial?.sourceType || "official_web"}
          onChange={(e) => {
            setCarrier(e.currentTarget.value);
          }}
        >
          {Object.entries(sourceTypeNames).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        所属机构
        <input
          name="organization"
          maxLength={250}
          defaultValue={initial?.organization}
        />
      </label>

      {currentCarrier !== "mini_program" && (
        <label>
          官网或公开账号链接
          <input
            name="websiteUrl"
            type="url"
            defaultValue={initial?.websiteUrl || ""}
          />
        </label>
      )}
      {["wechat_subscription", "wechat_service"].includes(currentCarrier) && (
        <label>
          公众号微信号
          <input
            name="wechatId"
            maxLength={100}
            defaultValue={initial?.wechatId || ""}
          />
        </label>
      )}
      {["mini_program", "enterprise_wechat", "embedded_app"].includes(
        currentCarrier,
      ) && (
        <label>
          小程序标识
          <input
            name="miniProgramId"
            maxLength={100}
            defaultValue={extra?.miniProgramId || ""}
          />
        </label>
      )}
      <label className="console-wide">
        备注
        <textarea
          name="sourceNote"
          maxLength={1000}
          defaultValue={extra?.sourceNote || ""}
        />
      </label>
      {similar.length > 0 && (
        <div className="console-wide">
          <p>相近来源（不会自动合并）</p>
          {similar.map((s) => (
            <p key={s.id}>
              <Link
                className="text-link"
                href={"/admin/sources?record=" + s.id}
              >
                {s.displayName} · {sourceTypeNames[s.sourceType]} ·{" "}
                {s.organization || "主体待核"}
              </Link>
            </p>
          ))}
        </div>
      )}
      <div className="console-actions console-wide">
        <button className="primary-button" disabled={busy}>
          保存信息源
        </button>
      </div>
    </form>
  );
}
function SourceWorkspace(props: WorkspaceProps) {
  const router = useRouter(),
    params = useSearchParams(),
    article = params.get("article"),
    [tab, setTab] = useState(params.get("tab") || "articles"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const lookup = useConsoleV2Data<{ sourceId: string }>(
    props.request,
    article ? "content/" + article : null,
  );
  const id = props.id || (article ? lookup.data?.sourceId : undefined);
  const { data, error, reload } = useConsoleV2Data<
    SourceV2 & { archivedAt: string | null }
  >(props.request, id && id !== "new" ? "v2/sources/" + id : null);
  if (props.id === "new")
    return (
      <>
        <div className="console-heading">
          <h1>添加信息源</h1>
        </div>
        <SourceForm
          request={props.request}
          onSaved={(id) =>
            router.replace("/admin/sources?record=" + id + "&tab=governance")
          }
        />
      </>
    );
  if (params.get("view") === "import") return <>{props.manualImport()}</>;
  if (article && !lookup.data) return <Loading error={lookup.error} />;
  if (!id)
    return (
      <Sources
        request={props.request}
        actor={props.actor}
        Dialog={props.Dialog}
      />
    );
  if (!data) return <Loading error={error || lookup.error} />;
  if (article)
    return (
      <>
        <Link className="console-back" href={"/admin/sources?record=" + id}>
          <ArrowLeft size={17} />
          返回
        </Link>
        {props.article(article)}
      </>
    );
  const source = data;
  async function operation(action: string) {
    setBusy(true);
    try {
      if (action === "archive")
        await props.request("sources/" + id, "DELETE", cmd(source.version));
      else if (action === "restore")
        await props.request(
          "v2/sources/" + id + "/restore",
          "POST",
          cmd(source.version),
        );
      else
        await props.request("sources/" + id + "/enabled", "POST", {
          ...cmd(source.version),
          enabled: !source.enabled,
        });
      setMessage("已保存");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="console-back" href="/admin/sources">
        <ArrowLeft size={17} />
        信息源
      </Link>
      <div className="console-heading">
        <h1>{source.displayName}</h1>
        <span className="console-badge">
          {source.enabled ? "启用" : "停运"}
        </span>
      </div>
      <div className="console-card console-v2-source-head">
        <p>
          {source.organization || "机构待补充"} ·{" "}
          {sourceTypeNames[source.sourceType]}
        </p>
        {safeExternalUrl(source.websiteUrl) && (
          <a
            className="text-link"
            href={source.websiteUrl!}
            target="_blank"
            rel="noopener noreferrer"
          >
            查看来源
          </a>
        )}
        <div className="console-actions">
          {props.actor.role !== "reviewer" && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void operation(source.archivedAt ? "restore" : "toggle")
                }
              >
                {source.archivedAt
                  ? "恢复来源"
                  : source.enabled
                    ? "停运"
                    : "启用"}
              </button>
              <button
                disabled={busy || !!source.archivedAt}
                onClick={() => void operation("archive")}
              >
                删除来源
              </button>
            </>
          )}
          <Link
            className="text-link"
            href={"/admin/whitelist?type=source&target=" + id}
          >
            白名单保护
          </Link>
          {source.collectorEnabled != null ? (
            <Link className="text-link" href="/admin/collector">
              公众号采集
            </Link>
          ) : (
            <Link className="text-link" href="/admin/web-collection">
              官网采集设置
            </Link>
          )}
        </div>
        <Feedback message={message} />
      </div>
      <div className="console-v2-tabs" role="tablist" aria-label="信息源详情">
        {[
          ["articles", "全部文章"],
          ["governance", "基本资料"],
          ...(source.collectorEnabled != null ? [["sync", "公众号采集"]] : []),
          ["history", "操作历史"],
        ].map(([v, l]) => (
          <button
            role="tab"
            key={v}
            aria-selected={tab === v}
            onClick={() => setTab(v)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "articles" ? (
        <>
          <div className="console-actions console-v2-heading-actions">
            <Link
              className="primary-button"
              href={"/admin/sources?view=import&source=" + id}
            >
              人工导入
            </Link>
          </div>
          <ConsoleV2Articles request={props.request} sourceId={id} />
        </>
      ) : tab === "governance" ? (
        <>
          <SourceForm
            key={"form" + source.version}
            request={props.request}
            id={id}
            extra={source}
            onSaved={() => reload()}
          />
        </>
      ) : tab === "sync" && source.collectorEnabled != null ? (
        <section className="console-card">
          <h2>公众号同步</h2>
          <p>
            {source.collectorEnabled && source.enabled
              ? "MP Tools 下载完成后自动同步。"
              : "此来源已暂停同步。"}
          </p>
          <Link className="text-link" href="/admin/collector">
            查看同步状态与使用方法
          </Link>
        </section>
      ) : tab === "sync" ? (
        <section className="console-card">
          <h2>公众号采集</h2>
          <p>公众号上游采集继续在本地运行。</p>
          <Link className="text-link" href="/admin/collector">
            打开公众号采集
          </Link>
        </section>
      ) : (
        <>{props.history(id)}</>
      )}
    </>
  );
}
type Dashboard = {
  stats: { sources: number; enabled: number; todayNew: number };
  storage: { provider: string; measured_at: string; bytes: number }[];
  protectedSources: number | null;
  protectedArticles: number | null;
};
function Dashboard(props: WorkspaceProps) {
  const params = useSearchParams(),
    [revision, setRevision] = useState(0),
    [filters] = useState<Record<string, string>>({}),
    [historyOpen, setHistoryOpen] = useState(params.get("view") === "history");
  const { data, error, reload } = useConsoleV2Data<Dashboard>(
    props.request,
    "v2/overview?" + new URLSearchParams(filters),
  );
  if (!data) return <Loading error={error} />;
  const stats = data.stats,
    metrics: [string, unknown][] = [
      ["信息源总数", stats.sources],
      ["启用", stats.enabled],
      ["停运", Number(stats.sources) - Number(stats.enabled)],
      ["今日新增文章", stats.todayNew],
      ["白名单来源", data.protectedSources],
      ["白名单文章", data.protectedArticles],
    ];
  return (
    <>
      <div className="console-heading">
        <h1>内容运营总览</h1>
        <button
          onClick={() => {
            reload();
            setRevision((v) => v + 1);
          }}
          aria-label="刷新总览"
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <TrafficPanel
        key={"traffic-" + revision}
        request={props.request}
        revision={revision}
      />
      <div className="console-v2-metrics">
        {metrics.map(([l, v]) => (
          <article className="console-card" key={l}>
            <span>{l}</span>
            <strong>
              {v === null || v === undefined ? "暂无指标" : String(v)}
            </strong>
          </article>
        ))}
      </div>
      <SourceSessionPanel
        key={"source-" + revision}
        request={props.request}
        admin={props.actor.role === "admin"}
        revision={revision}
      />
      <section className="console-card">
        <h2>D1存储</h2>
        {data.storage.length ? (
          <>
            <strong>{(data.storage[0].bytes / 1048576).toFixed(2)} MiB</strong>
            {data.storage.length > 1 && (
              <p>
                相对上次实测变化 {data.storage[0].bytes - data.storage[1].bytes}{" "}
                字节
              </p>
            )}
            <p>
              {data.storage[0].provider === "cloudflare_api"
                ? "Cloudflare当前"
                : "本地测试库"}{" "}
              · {date(data.storage[0].measured_at)}
            </p>
          </>
        ) : (
          <p className="console-empty">暂无指标</p>
        )}
      </section>
      <details
        className="console-card"
        open={historyOpen}
        onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
      >
        <summary>审计日志</summary>
        {historyOpen && props.history()}
      </details>
    </>
  );
}
export function ConsoleV2Workspace(props: WorkspaceProps) {
  if (props.section === "feedback")
    return <FeedbackWorkspace request={props.request} />;
  if (props.section === "web-collection")
    return (
      <OfficialWebCollectionPanel
        request={props.request}
        admin={props.actor.role === "admin"}
      />
    );
  if (props.section === "collector")
    return <CollectorPanel request={props.request} />;
  if (props.section === "sources") return <SourceWorkspace {...props} />;
  if (props.section === "articles" || props.section === "reviews")
    return (
      <>
        <div className="console-heading">
          <h1>文章</h1>
        </div>
        <ConsoleV2Articles request={props.request} />
      </>
    );
  if (props.section === "whitelist")
    return (
      <WhitelistWorkspace
        request={props.request}
        admin={props.actor.role === "admin"}
        Dialog={props.Dialog}
      />
    );
  if (props.section === "retention")
    return (
      <RetentionWorkspace
        request={props.request}
        admin={props.actor.role === "admin"}
        Dialog={props.Dialog}
      />
    );
  return <Dashboard {...props} />;
}
