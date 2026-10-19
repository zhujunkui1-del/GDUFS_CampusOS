"use client";
import { SourceCollectionPolicy, RunnerTokens } from "./sync-panel";
import { WhitelistWorkspace, RetentionWorkspace } from "./retention-workspace";
import { AutoPolicyPanel } from "./automation-panel";
import Link from "next/link";
import {
  useEffect,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, ArrowLeft, RefreshCw, Pause } from "lucide-react";
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
const campuses: [string, string][] = [
  ["all", "全校"],
  ["university_town", "大学城"],
  ["baiyun", "白云山"],
  ["online", "线上"],
  ["unknown", "待核实"],
];
const hours = [1, 3, 6, 12, 24];
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
}: {
  fields: ConsoleFilter[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  return (
    <details className="console-card console-v2-filters">
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
          onChange(values);
        }}
      >
        {fields.map((f) => (
          <label key={f.name}>
            {f.label}
            {f.options ? (
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
        <label>
          排序方向
          <select name="direction" defaultValue={values.direction || "desc"}>
            <option value="desc">从新到旧 / 降序</option>
            <option value="asc">从旧到新 / 升序</option>
          </select>
        </label>
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
  { name: "organization", label: "学院、部门或社团" },
  { name: "campus", label: "校区", options: campuses },
  {
    name: "state",
    label: "启用状态",
    options: [
      ["enabled", "启用"],
      ["closed", "停运"],
    ],
  },
  {
    name: "automatic",
    label: "自动采集",
    options: [
      ["1", "支持官网连接器"],
      ["0", "需人工导入"],
    ],
  },
  {
    name: "error",
    label: "同步错误",
    options: [
      ["1", "有异常"],
      ["0", "无异常"],
    ],
  },
  { name: "updatedAfter", label: "更新起日", type: "date" },
  { name: "updatedBefore", label: "更新止日", type: "date" },
  { name: "minArticles", label: "最少文章数", type: "number" },
  { name: "maxArticles", label: "最多文章数", type: "number" },
  {
    name: "sort",
    label: "排序",
    options: [
      ["updated", "最近更新"],
      ["name", "名称"],
      ["articles", "文章数量"],
      ["next_sync", "计划时间"],
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
  { name: "campus", label: "校区", options: campuses },
  {
    name: "review",
    label: "审核状态",
    options: [
      ["approved", "批准"],
      ["unapproved", "尚未批准"],
    ],
  },
  { name: "publishedAfter", label: "发布起日", type: "date" },
  { name: "eventAfter", label: "活动起日", type: "date" },
  { name: "eventBefore", label: "活动止日", type: "date" },
  {
    name: "deadline",
    label: "报名截止",
    options: [
      ["open", "尚未截止"],
      ["closed", "已截止"],
      ["unknown", "未知"],
    ],
  },
  {
    name: "body",
    label: "正文完整性",
    options: [
      ["unknown", "未知"],
      ["not_provided", "仅元数据"],
      ["partial", "部分正文"],
      ["complete", "声明完整"],
    ],
  },
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
  async function batch(decision: string) {
    setBusy(true);
    let done = 0;
    const errors = [];
    for (const d of selected)
      try {
        await request("content/" + d.id + "/review", "POST", {
          ...cmd(Number(d.version)),
          decision,
        });
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
            disabled={busy || !selected.length}
            onClick={() => void batch("returned")}
          >
            批量退回
          </button>
          <button
            disabled={busy || !selected.length}
            onClick={() => void batch("rejected")}
          >
            批量拒绝
          </button>
          <button
            disabled={busy || !selected.length}
            onClick={() => void batch("approved")}
          >
            批量批准
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
                      {d.publication_status === "published"
                        ? d.public_visible === 1
                          ? "已公开"
                          : "公开已失效"
                        : d.publication_status === "withdrawn"
                          ? "已撤回"
                          : d.workflow_status === "approved"
                            ? "已批准"
                            : "待处理"}
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
                    href={"/admin/sources?record=" + encodeURIComponent(s.id)}
                  >
                    <h2>{s.displayName}</h2>
                    <p>
                      {s.organization || "机构待补充"} ·{" "}
                      {sourceTypeNames[s.sourceType]} ·{" "}
                      {campuses.find((c) => c[0] === s.campusScope)?.[1]}
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
                      <span>
                        {s.automatic ? "可自动同步" : "需人工导入 / 同步受限"}
                      </span>
                      {s.protected && <span>白名单保护</span>}
                    </div>
                    <dl className="console-v2-inline">
                      <dt>文章</dt>
                      <dd>{s.articleCount}</dd>
                      <dt>已公开</dt>
                      <dd>{s.publishedCount}</dd>
                      <dt>最近成功</dt>
                      <dd>{date(s.lastSuccessAt)}</dd>
                      <dt>下次计划</dt>
                      <dd>{date(s.nextSyncAt)}</dd>
                    </dl>
                    {s.lastError && (
                      <p className="console-error">{s.lastError}</p>
                    )}
                  </Link>
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
      campusScope: String(f.get("campusScope")) as SourceInput["campusScope"],
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
      <label>
        校区
        <select
          name="campusScope"
          defaultValue={initial?.campusScope || "unknown"}
        >
          {campuses.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
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
          <span>
            {source.automatic ? "自动同步可用" : "自动同步受限 / 需人工导入"}
          </span>
        </div>
        <Feedback message={message} />
      </div>
      <div className="console-v2-tabs" role="tablist" aria-label="信息源详情">
        {[
          ["articles", "全部文章"],
          ["governance", "基本资料"],
          ["sync", "同步状态"],
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
      ) : tab === "sync" ? (
        <>
          <RunnerTokens
            request={props.request}
            admin={props.actor.role === "admin"}
          />
          <SourceCollectionPolicy
            request={props.request}
            id={id}
            version={source.version}
            admin={props.actor.role === "admin"}
            reload={reload}
          />
          <AutoPolicyPanel
            request={props.request}
            sourceId={id}
            version={source.version}
            admin={props.actor.role === "admin"}
            reload={reload}
          />
          <section className="console-card">
            <h2>同步状态</h2>
            <button
              disabled={
                busy || !source.automatic || props.actor.role === "reviewer"
              }
              onClick={() => {
                setBusy(true);
                void props
                  .request<{ registered: number; state: string }>(
                    "v2/sync",
                    "POST",
                    {
                      commandId: crypto.randomUUID(),
                      sourceId: id,
                    },
                  )
                  .then((r) => {
                    setMessage(syncFeedback(r));
                    reload();
                  })
                  .catch((e) => setMessage(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              手动同步
            </button>
            <dl className="console-details">
              <dt>最近成功</dt>
              <dd>{date(source.lastSuccessAt)}</dd>
              <dt>下次计划</dt>
              <dd>{date(source.nextSyncAt)}</dd>
              <dt>同步间隔</dt>
              <dd>{source.syncHours}小时</dd>
              <dt>最近异常</dt>
              <dd>{source.lastError || "无记录"}</dd>
            </dl>
            <form
              className="console-actions"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void props
                  .request("v2/sources/" + id + "/sync-settings", "POST", {
                    ...cmd(source.version),
                    hours: f.get("hours") ? Number(f.get("hours")) : null,
                    note: "管理员调整单源同步周期",
                  })
                  .then(() => {
                    reload();
                    setMessage("已保存周期");
                  })
                  .catch((e) => setMessage(e.message));
              }}
            >
              <select
                name="hours"
                aria-label="单源同步频率"
                defaultValue={source.syncOverride || ""}
              >
                <option value="">继承全局</option>
                {hours.map((h) => (
                  <option key={h} value={h}>
                    每{h}小时
                  </option>
                ))}
              </select>
              <button disabled={props.actor.role === "reviewer"}>
                保存周期
              </button>
            </form>
          </section>
          {props.jobs(id)}
        </>
      ) : (
        <>{props.history(id)}</>
      )}
    </>
  );
}
type Engine = {
  version: number;
  sync_hours: number;
  auto_sync_enabled: number;
  network_budget: number;
  earliest_import_day: string | null;
  runner_last_at: string | null;
  last_cleanup_json: string;
};
type Dashboard = {
  stats: Record<string, string | number | null>;
  filteredSources: number;
  settings: Engine;
  networkUsage: number;
  storage: { provider: string; measured_at: string; bytes: number }[];
  unsupported: number;
  scheduler: string;
  runnerOnline: boolean;
  autoPublishedToday: number | null;
  protectedSources: number | null;
  protectedArticles: number | null;
  latestJobs: Record<string, unknown>[];
};
function Dashboard(props: WorkspaceProps) {
  const params = useSearchParams(),
    [filters] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(""),
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
      ["未配置自动连接器", data.unsupported],
      [
        filters.from || filters.to ? "范围内发现出处" : "今日发现出处",
        stats.discoveredToday,
      ],
      [
        filters.from || filters.to ? "范围内新增文章" : "今日新增文章",
        stats.todayNew,
      ],
      ["待人工处理", stats.pending],
      ["采集异常", stats.failed],
      ["发布阻断", stats.blocked],
      ["撤回或过期", stats.inactive],
      [
        filters.from || filters.to ? "范围内自动发布" : "今日自动发布",
        data.autoPublishedToday,
      ],
      ["白名单来源", data.protectedSources],
      ["白名单文章", data.protectedArticles],
    ];
  return (
    <>
      <div className="console-heading">
        <h1>内容运营总览</h1>
        <button onClick={reload} aria-label="刷新总览">
          <RefreshCw size={18} />
        </button>
      </div>
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
      <section className="console-card">
        <h2>信息源同步设置</h2>
        <p>本地执行器在线时才会完成同步；任务登记不代表采集完成。</p>
        <div className="console-v2-sync-line">
          <div>
            <span>最近完成</span>
            <strong>{date(stats.lastSync)}</strong>
          </div>
          <div>
            <span>下次计划检查</span>
            <strong>{date(stats.nextSync)}</strong>
          </div>
          <div>
            <span>执行器</span>
            <strong>
              {data.settings.runner_last_at
                ? (!data.runnerOnline ? "离线；上次 " : "最近在线 ") +
                  date(data.settings.runner_last_at)
                : "未连接"}
            </strong>
          </div>
        </div>
        <form
          className="console-actions"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void props
              .request("v2/settings", "POST", {
                ...cmd(data.settings.version),
                syncHours: Number(f.get("hours")),
                autoSync: data.settings.auto_sync_enabled === 1,
                networkBudget: data.settings.network_budget,
                earliestImportDay: data.settings.earliest_import_day,
                note: "管理员调整全局同步周期",
              })
              .then(() => {
                reload();
                setMessage("同步设置已保存");
              })
              .catch((e) => setMessage(e.message));
          }}
        >
          <select
            aria-label="全局同步频率"
            name="hours"
            defaultValue={data.settings.sync_hours}
          >
            {hours.map((h) => (
              <option key={h} value={h}>
                每{h}小时
              </option>
            ))}
          </select>
          <button disabled={props.actor.role !== "admin"}>保存同步设置</button>
          <button
            type="button"
            disabled={props.actor.role !== "admin"}
            onClick={() =>
              void props
                .request("v2/settings", "POST", {
                  ...cmd(data.settings.version),
                  syncHours: data.settings.sync_hours,
                  autoSync: !data.settings.auto_sync_enabled,
                  networkBudget: data.settings.network_budget,
                  earliestImportDay: data.settings.earliest_import_day,
                  note:
                    "管理员" +
                    (data.settings.auto_sync_enabled ? "暂停" : "恢复") +
                    "自动同步",
                })
                .then(reload)
                .catch((e) => setMessage(e.message))
            }
          >
            {data.settings.auto_sync_enabled ? (
              <>
                <Pause size={16} />
                暂停自动同步
              </>
            ) : (
              "恢复自动同步"
            )}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={props.actor.role !== "admin"}
            onClick={() =>
              void props
                .request<{ registered: number; state: string }>(
                  "v2/sync",
                  "POST",
                  { commandId: crypto.randomUUID() },
                )
                .then((r) => {
                  setMessage(syncFeedback(r));
                  reload();
                })
                .catch((e) => setMessage(e.message))
            }
          >
            立即同步
          </button>
        </form>
        <Feedback message={message} />
      </section>
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
                ? "Cloudflare实测"
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
  if (props.section === "sources") return <SourceWorkspace {...props} />;
  if (props.section === "reviews")
    return (
      <>
        <div className="console-heading">
          <h1>内容审核</h1>
        </div>
        <ConsoleV2Articles
          request={props.request}
          exceptions
          canReview={["admin", "reviewer"].includes(props.actor.role)}
        />
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

function syncFeedback(r: { registered: number; state: string }) {
  if (r.state === "runner_offline") return "采集器离线，启动后重试";
  if (r.state === "budget_exhausted") return "今日同步额度已用完";
  if (r.state === "busy") return "同步正在处理，请稍后查看";
  if (r.registered) return `已加入同步队列，共${r.registered}个来源`;
  return "当前来源已有任务，或访问许可暂不可用";
}
