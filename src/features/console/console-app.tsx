"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  ArrowLeft,
  LayoutDashboard,
  Library,
  ClipboardCheck,
  FileText,
  ListChecks,
  ShieldCheck,
  LogOut,
  Plus,
  Search,
} from "lucide-react";
import {
  sourceTypeNames,
  statusNames,
  safeExternalUrl,
  type ConsoleActor,
  type SourceInput,
  type SourceSummary,
  type SourceDetail,
  type ContentSummary,
  type ContentDetail,
  type ContentInput,
} from "@/domain/console/contracts";

type Auth = {
  authenticated: boolean;
  mode: "local" | "access";
  actor?: ConsoleActor;
  csrf?: string;
  environment?: string;
};
type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type List<T> = { items: T[]; total?: number; offset: number; limit: number };
const navigation = [
  { id: "", label: "总览", icon: LayoutDashboard },
  { id: "sources", label: "信息源", icon: Library },
  { id: "jobs", label: "采集任务", icon: ListChecks },
  { id: "reviews", label: "内容审核", icon: ClipboardCheck },
  { id: "content", label: "内容记录", icon: FileText },
  { id: "audit", label: "审计日志", icon: ShieldCheck },
];
const date = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "—";
const short = (s: string) => statusNames[s] || s;
function Message({ children }: { children: ReactNode }) {
  return <p className="console-empty">{children}</p>;
}
function Badge({ value }: { value: string }) {
  return (
    <span className={`console-badge console-status-${value}`}>
      {short(value)}
    </span>
  );
}
function External({
  url,
  label,
}: {
  url: string | null | undefined;
  label?: string;
}) {
  const safe = safeExternalUrl(url);
  return safe ? (
    <a
      className="text-link console-url"
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label || safe}
    </a>
  ) : (
    <span>—</span>
  );
}
function command(version: number) {
  return { commandId: crypto.randomUUID(), expectedVersion: version };
}
const recordHref = (section: "sources" | "content", id: string) =>
  `/admin/${section}?record=${encodeURIComponent(id)}`;

export function ConsoleApp() {
  const pathname = usePathname(),
    parts = pathname.split("/").filter(Boolean).slice(1),
    section = parts[0] || "",
    id = useSearchParams().get("record");
  const [auth, setAuth] = useState<Auth | null>(null),
    [error, setError] = useState(""),
    [checking, setChecking] = useState(true),
    [key, setKey] = useState("");
  const current = useRef(auth);
  const authEpoch = useRef(0),
    connecting = useRef(false);
  useEffect(() => {
    current.current = auth;
  }, [auth]);
  const request = useCallback<Client>(
    async <T,>(path: string, method = "GET", body?: unknown) => {
      const response = await fetch(
        path.startsWith("/api/") ? path : "/api/admin/" + path,
        {
          method,
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...(method !== "GET" && current.current?.csrf
              ? { "X-Console-CSRF": current.current.csrf }
              : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(15000),
        },
      );
      let result;
      try {
        result = await response.json();
      } catch {
        throw Error("登录已失效，请重新进入后台。");
      }
      if (!response.ok || !result.ok) {
        if (response.status === 401) {
          setAuth((previous) =>
            previous
              ? {
                  authenticated: false,
                  mode: previous.mode,
                  environment: previous.environment,
                }
              : null,
          );
        }
        throw Error(result.error?.message || "操作未完成，请重试。");
      }
      return result.data as T;
    },
    [],
  );
  const connect = useCallback(async () => {
    if (connecting.current) return;
    connecting.current = true;
    const epoch = authEpoch.current;
    try {
      let state = await request<Auth>("/api/console-auth");
      if (!state.authenticated && state.mode === "access")
        state = await request<Auth>("/api/console-auth", "POST", {});
      if (epoch === authEpoch.current) {
        setAuth(state);
        setError("");
      }
    } catch (e) {
      if (epoch === authEpoch.current) {
        setAuth(null);
        setError(e instanceof Error ? e.message : "管理服务暂不可用。");
      }
    } finally {
      connecting.current = false;
      if (epoch === authEpoch.current) setChecking(false);
    }
  }, [request]);
  useEffect(() => {
    void Promise.resolve().then(connect);
    const focus = () => {
      void connect();
    };
    window.addEventListener("pageshow", focus);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("pageshow", focus);
      window.removeEventListener("focus", focus);
    };
  }, [connect]);
  async function signIn(event: FormEvent) {
    event.preventDefault();
    const epoch = ++authEpoch.current;
    setChecking(true);
    setError("");
    try {
      const next = await request<Auth>("/api/console-auth", "POST", { key });
      if (epoch === authEpoch.current) setAuth(next);
      setKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败。");
    } finally {
      setChecking(false);
    }
  }
  async function signOut() {
    ++authEpoch.current;
    try {
      await request("/api/console-auth", "DELETE");
      const access = auth?.mode === "access";
      setAuth({
        authenticated: false,
        mode: auth!.mode,
        environment: auth?.environment,
      });
      setKey("");
      if (access)
        window.location.assign(
          new URL("/cdn-cgi/access/logout", window.location.origin).href,
        );
    } catch {
      setError("退出未完成，请重试。");
    }
  }
  if (!auth?.authenticated)
    return (
      <main className="console-login">
        <Link href="/map" className="console-back">
          <ArrowLeft size={18} />
          返回校园
        </Link>
        <section className="console-card">
          <p className="console-eyebrow">CampusOS Console</p>
          <h1>内容运营后台</h1>
          {checking ? (
            <Message>正在验证管理员身份…</Message>
          ) : auth?.mode === "local" ? (
            <form onSubmit={signIn}>
              <label>
                管理员访问密钥
                <input
                  aria-label="管理员访问密钥"
                  autoComplete="off"
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <button className="primary-button" disabled={!key}>
                登录
              </button>
            </form>
          ) : (
            <>
              <Message>{error || "请通过管理员身份验证后进入。"}</Message>
              <button onClick={() => void connect()}>重新验证</button>
            </>
          )}
          {error && auth?.mode === "local" && (
            <p className="console-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    );
  return (
    <div className="console-shell">
      <aside className="console-sidebar">
        <Link className="console-brand" href="/admin">
          CampusOS <span>Console</span>
        </Link>
        <nav aria-label="后台导航">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={"/admin" + (item.id ? "/" + item.id : "")}
                aria-current={section === item.id ? "page" : undefined}
              >
                <Icon size={19} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Link href="/map" className="console-return">
          <ArrowLeft size={17} />
          返回校园
        </Link>
      </aside>
      <div className="console-workspace">
        <header className="console-header">
          <span>{auth.actor?.email}</span>
          <span className="console-environment">
            {auth.environment === "local" ? "本地" : "预览"}
          </span>
          <button onClick={() => void signOut()} aria-label="安全退出">
            <LogOut size={17} />
            <span>安全退出</span>
          </button>
        </header>
        {error && (
          <p className="console-error" role="alert">
            {error}
          </p>
        )}
        <main id="console-main" key={pathname + ":" + (id || "")}>
          {section === "" ? (
            <Overview request={request} />
          ) : section === "sources" ? (
            id ? (
              <SourceEditor
                key={id}
                id={id}
                request={request}
                actor={auth.actor!}
              />
            ) : (
              <Sources request={request} />
            )
          ) : section === "content" ? (
            id ? (
              <ContentEditor
                key={id}
                id={id}
                request={request}
                actor={auth.actor!}
              />
            ) : (
              <ContentList request={request} />
            )
          ) : section === "reviews" ? (
            <ContentList request={request} review />
          ) : section === "jobs" ? (
            <Jobs request={request} />
          ) : section === "audit" ? (
            <Audit request={request} />
          ) : (
            <Message>未找到该后台页面。</Message>
          )}
        </main>
      </div>
    </div>
  );
}
function useLoad<T>(load: () => Promise<T>, dependencies: unknown[]) {
  const [result, setResult] = useState<{
      key: string;
      revision: number;
      data: T | null;
      error: string;
    }>({ key: "", revision: -1, data: null, error: "" }),
    [revision, setRevision] = useState(0);
  const key = JSON.stringify(dependencies);
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(load)
      .then((value) => {
        if (active) setResult({ key, revision, data: value, error: "" });
      })
      .catch((e) => {
        if (active)
          setResult({
            key,
            revision,
            data: null,
            error: e instanceof Error ? e.message : "加载失败。",
          });
      });
    return () => {
      active = false;
    };
    // Fetch only when the explicit route/filter key or refresh revision changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  return {
    data:
      result.key === key && result.revision === revision ? result.data : null,
    error:
      result.key === key && result.revision === revision ? result.error : "",
    reload: () => setRevision((x) => x + 1),
  };
}
function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="console-heading">
      <h1>{title}</h1>
      {children}
    </div>
  );
}
function Pagination({
  offset,
  total,
  limit,
  onChange,
}: {
  offset: number;
  total?: number;
  limit: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="console-pagination">
      <span>
        {total === undefined
          ? `第 ${Math.floor(offset / limit) + 1} 页`
          : `${total} 条`}
      </span>
      <button
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        上一页
      </button>
      <button
        disabled={total === undefined ? false : offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        下一页
      </button>
    </div>
  );
}
function Overview({ request }: { request: Client }) {
  const { data, error } = useLoad(
    () =>
      request<{
        stats: Record<string, number>;
        collectorEnabled: boolean;
        indexEnabled: boolean;
      }>("overview"),
    [],
  );
  return (
    <>
      <Heading title="总览" />
      {error ? (
        <Message>{error}</Message>
      ) : !data ? (
        <Message>正在加载…</Message>
      ) : (
        <>
          <div className="console-stats">
            {[
              ["信息源", data.stats.sources],
              ["候选来源", data.stats.candidates],
              ["已核验来源", data.stats.verified],
              ["待审核内容", data.stats.pending],
            ].map(([label, value]) => (
              <div className="console-card" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <section className="console-card">
            <h2>采集状态</h2>
            <Message>采集未启用</Message>
            <p>最近采集异常：{data.stats.failedJobs}</p>
            <Link className="text-link" href="/admin/jobs">
              查看任务
            </Link>
          </section>
          <section className="console-card">
            <h2>内容发布</h2>
            <p>检索索引尚未启用</p>
            <p>待处理失效记录：{data.stats.pendingInvalidations}</p>
            <Link href="/admin/reviews" className="text-link">
              查看审核队列
            </Link>
          </section>
        </>
      )}
    </>
  );
}
function Sources({ request }: { request: Client }) {
  const [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [type, setType] = useState(""),
    [verification, setVerification] = useState(""),
    [offset, setOffset] = useState(0);
  const { data, error } = useLoad(
    () =>
      request<List<SourceSummary>>(
        `sources?${new URLSearchParams({ q: search, ...(type ? { type } : {}), ...(verification ? { verification } : {}), offset: String(offset) })}`,
      ),
    [search, type, verification, offset],
  );
  return (
    <>
      <Heading title="信息源">
        <Link className="primary-button" href={recordHref("sources", "new")}>
          <Plus size={17} />
          登记来源
        </Link>
      </Heading>
      <form
        className="console-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
          setOffset(0);
        }}
      >
        <label className="console-search">
          <Search size={18} />
          <input
            aria-label="搜索信息源"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="名称、别名或编号"
          />
        </label>
        <button>搜索</button>
        <select
          aria-label="来源类型"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">全部类型</option>
          {Object.entries(sourceTypeNames).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="核验状态"
          value={verification}
          onChange={(e) => {
            setVerification(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">全部核验状态</option>
          {["candidate", "pending", "verified", "rejected"].map((value) => (
            <option key={value} value={value}>
              {short(value)}
            </option>
          ))}
        </select>
      </form>
      {error ? (
        <Message>{error}</Message>
      ) : !data ? (
        <Message>正在加载…</Message>
      ) : (
        <>
          <section className="console-card console-list">
            {data.items.length ? (
              data.items.map((source) => (
                <Link
                  className="console-source-row"
                  key={source.id}
                  href={recordHref("sources", source.id)}
                >
                  <div>
                    <strong>{source.displayName}</strong>
                    <span>
                      {sourceTypeNames[source.sourceType]} ·{" "}
                      {source.organization || "—"}
                    </span>
                  </div>
                  <Badge value={source.verificationStatus} />
                  <span>{source.enabled ? "已启用" : "已暂停"}</span>
                </Link>
              ))
            ) : (
              <Message>没有匹配的信息源。</Message>
            )}
          </section>
          <Pagination
            offset={offset}
            total={data.total}
            limit={20}
            onChange={setOffset}
          />
        </>
      )}
    </>
  );
}
const emptySource: SourceInput = {
  displayName: "",
  sourceAliases: [],
  sourceType: "manual_import",
  subtype: "",
  organization: "",
  campusScope: "unknown",
  websiteUrl: null,
  wechatId: null,
  evidenceUrls: [],
  priority: 3,
  connectorType: "disabled",
  connectorConfig: {},
  fetchPolicy: { mode: "disabled", maxRequests: 0 },
};
function sourceInput(value: SourceDetail): SourceInput {
  return {
    displayName: value.displayName,
    sourceAliases: value.sourceAliases,
    sourceType: value.sourceType,
    subtype: value.subtype,
    organization: value.organization,
    campusScope: value.campusScope,
    websiteUrl: value.websiteUrl,
    wechatId: value.wechatId,
    evidenceUrls: value.evidenceUrls,
    priority: value.priority,
    connectorType: value.connectorType,
    connectorConfig: value.connectorConfig,
    fetchPolicy: value.fetchPolicy,
  };
}
function SourceEditor({
  id,
  request,
  actor,
}: {
  id: string;
  request: Client;
  actor: ConsoleActor;
}) {
  const router = useRouter(),
    isNew = id === "new",
    { data, error, reload } = useLoad(
      () =>
        isNew ? Promise.resolve(null) : request<SourceDetail>("sources/" + id),
      [id],
    );
  const [draft, setDraft] = useState<SourceInput | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [verify, setVerify] = useState(false),
    [archive, setArchive] = useState(false);
  const form = draft || (data ? sourceInput(data) : emptySource);
  const write = actor.role !== "reviewer";
  const set = <K extends keyof SourceInput>(name: K, value: SourceInput[K]) =>
    setDraft({ ...form, [name]: value });
  async function run(work: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setMessage("");
    try {
      await work();
      setMessage("已保存");
      setDraft(null);
      after?.();
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作失败。");
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const result = await request<{ id: string }>(
        isNew ? "sources" : "sources/" + id,
        isNew ? "POST" : "PATCH",
        {
          ...form,
          ...(isNew
            ? { commandId: crypto.randomUUID() }
            : command(data!.version)),
        },
      );
      if (isNew) router.replace(recordHref("sources", result.id));
    });
  }
  if (error) return <Message>{error}</Message>;
  if (!isNew && !data) return <Message>正在加载…</Message>;
  return (
    <>
      <Link className="console-back" href="/admin/sources">
        <ArrowLeft size={17} />
        信息源
      </Link>
      <Heading title={isNew ? "登记信息源" : data!.displayName}>
        {data && <Badge value={data.verificationStatus} />}
      </Heading>
      {message && (
        <p className="console-feedback" role="status">
          {message}
        </p>
      )}
      <form className="console-card console-form" onSubmit={save}>
        <label>
          名称
          <input
            required
            value={form.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            maxLength={200}
          />
        </label>
        <label>
          别名
          <input
            value={form.sourceAliases.join("；")}
            onChange={(e) =>
              set("sourceAliases", e.target.value.split("；").filter(Boolean))
            }
          />
        </label>
        <label>
          类型
          <select
            value={form.sourceType}
            onChange={(e) =>
              set("sourceType", e.target.value as SourceInput["sourceType"])
            }
          >
            {Object.entries(sourceTypeNames).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          细分类
          <input
            value={form.subtype}
            onChange={(e) => set("subtype", e.target.value)}
          />
        </label>
        <label>
          所属机构
          <input
            value={form.organization}
            onChange={(e) => set("organization", e.target.value)}
          />
        </label>
        <label>
          校区范围
          <select
            value={form.campusScope}
            onChange={(e) =>
              set("campusScope", e.target.value as SourceInput["campusScope"])
            }
          >
            {[
              ["unknown", "待核实"],
              ["all", "全校"],
              ["university_town", "大学城"],
              ["baiyun", "白云山"],
              ["online", "线上"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          网站网址
          <input
            type="url"
            value={form.websiteUrl || ""}
            onChange={(e) => set("websiteUrl", e.target.value || null)}
          />
        </label>
        <label>
          微信号
          <input
            value={form.wechatId || ""}
            onChange={(e) => set("wechatId", e.target.value || null)}
          />
        </label>
        <label className="console-wide">
          证据链接
          <textarea
            rows={3}
            value={form.evidenceUrls.join("\n")}
            onChange={(e) =>
              set(
                "evidenceUrls",
                e.target.value
                  .split("\n")
                  .map((v) => v.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        <label>
          优先级
          <select
            value={form.priority}
            onChange={(e) => set("priority", Number(e.target.value))}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {"P" + n}
              </option>
            ))}
          </select>
        </label>
        <label>
          连接方式
          <select
            value={form.connectorType}
            onChange={(e) =>
              set(
                "connectorType",
                e.target.value as SourceInput["connectorType"],
              )
            }
          >
            {[
              ["disabled", "未配置"],
              ["manual", "人工导入"],
              ["official_web", "官网连接器（未启用）"],
              ["wechat_link_manual", "公众号文章链接（人工）"],
              ["entry_only", "仅服务入口"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="console-wide console-actions">
          {data?.enabled && <p>修改后暂停来源，需重新核验。</p>}
          <button className="primary-button" disabled={busy || !write}>
            保存信息源
          </button>
        </div>
      </form>
      {data && (
        <>
          <section className="console-card">
            <div className="console-heading">
              <h2>核验与状态</h2>
              <div className="console-actions">
                <button
                  disabled={busy || !write}
                  onClick={() => setVerify(true)}
                >
                  核验来源
                </button>
                <button
                  disabled={busy || !write}
                  onClick={() =>
                    void run(() =>
                      request("sources/" + id + "/enabled", "POST", {
                        ...command(data.version),
                        enabled: !data.enabled,
                      }),
                    )
                  }
                >
                  {data.enabled ? "暂停来源" : "启用来源"}
                </button>
                <button
                  className="console-danger-text"
                  disabled={busy || !write}
                  onClick={() => setArchive(true)}
                >
                  归档来源
                </button>
              </div>
            </div>
            <dl className="console-details">
              <dt>归属</dt>
              <dd>
                <Badge value={data.officialStatus} />
              </dd>
              <dt>采集许可</dt>
              <dd>
                <Badge value={data.permissionStatus} />
              </dd>
              <dt>最近核验</dt>
              <dd>{date(data.lastCheckedAt)}</dd>
              <dt>最近成功采集</dt>
              <dd>{date(data.lastSuccessAt)}</dd>
              <dt>版本</dt>
              <dd>{data.version}</dd>
            </dl>
          </section>
          <section className="console-card">
            <h2>来源证据</h2>
            {data.evidenceUrls.map((url) => (
              <p key={url}>
                <External url={url} />
              </p>
            ))}
            {data.originalCatalogRefs.map((ref, i) => (
              <p className="console-provenance" key={i}>
                {ref.file}
                {ref.sheet ? " · " + ref.sheet : ""}
                {ref.row ? " · 第 " + ref.row + " 行" : ""}
                {ref.line ? " · 第 " + ref.line + " 行" : ""}
              </p>
            ))}
            {typeof data.catalogMetadata.catalogStatus === "string" && (
              <p>资料状态：{data.catalogMetadata.catalogStatus}</p>
            )}
          </section>
          <Verification
            key={data.id + ":" + data.version}
            open={verify}
            onClose={() => setVerify(false)}
            source={data}
            busy={busy}
            save={(body) =>
              void run(
                () =>
                  request("sources/" + id + "/verify", "POST", {
                    ...command(data.version),
                    ...body,
                  }),
                () => setVerify(false),
              )
            }
          />
          <Confirm
            open={archive}
            onClose={() => setArchive(false)}
            title="归档这个信息源？"
            description="来源将被暂停，关联内容将停止公开。历史和审计记录保留。"
            action="归档"
            busy={busy}
            confirm={() =>
              void run(
                () => request("sources/" + id, "DELETE", command(data.version)),
                () => router.push("/admin/sources"),
              )
            }
          />
        </>
      )}
    </>
  );
}
function Confirm({
  open,
  onClose,
  title,
  description,
  action,
  busy,
  confirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  action: string;
  busy: boolean;
  confirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="conversation-confirm-backdrop" />
        <AlertDialog.Popup
          className="conversation-confirm"
          initialFocus={cancel}
        >
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
          <div className="conversation-confirm-actions">
            <AlertDialog.Close ref={cancel} disabled={busy}>
              取消
            </AlertDialog.Close>
            <button
              className="conversation-danger"
              disabled={busy}
              onClick={confirm}
            >
              {action}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
function Verification({
  open,
  onClose,
  source,
  busy,
  save,
}: {
  open: boolean;
  onClose: () => void;
  source: SourceDetail;
  busy: boolean;
  save: (value: Record<string, unknown>) => void;
}) {
  const [status, setStatus] = useState("verified"),
    [official, setOfficial] = useState<string>(source.officialStatus),
    [permission, setPermission] = useState<string>(source.permissionStatus),
    [note, setNote] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="conversation-confirm-backdrop" />
        <AlertDialog.Popup className="conversation-confirm console-verification">
          <AlertDialog.Title>核验来源</AlertDialog.Title>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save({
                status,
                officialStatus: official,
                permissionStatus: permission,
                note,
                authorityConfirmed: confirmed,
                evidenceUrls: source.evidenceUrls,
              });
            }}
          >
            <label>
              核验结果
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {["verified", "pending", "rejected"].map((s) => (
                  <option key={s} value={s}>
                    {short(s)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              官方主体
              <select
                value={official}
                onChange={(e) => setOfficial(e.target.value)}
              >
                {[
                  "unverified",
                  "claimed_official",
                  "verified_official",
                  "unofficial",
                ].map((s) => (
                  <option key={s} value={s}>
                    {short(s)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              采集许可
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
              >
                {["unreviewed", "approved", "denied", "entry_only"].map((s) => (
                  <option key={s} value={s}>
                    {short(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="console-checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              已核对官方主体或官网归属证据
            </label>
            <label>
              核验说明
              <textarea
                required
                minLength={5}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
            </label>
            <div className="console-actions">
              <AlertDialog.Close disabled={busy}>取消</AlertDialog.Close>
              <button type="submit" className="primary-button" disabled={busy}>
                保存核验
              </button>
            </div>
          </form>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
function ContentList({
  request,
  review = false,
}: {
  request: Client;
  review?: boolean;
}) {
  const [offset, setOffset] = useState(0),
    [status, setStatus] = useState(review ? "pending" : "");
  const { data, error } = useLoad(
    () =>
      request<List<ContentSummary>>(
        `content?offset=${offset}${status ? "&status=" + status : ""}`,
      ),
    [offset, status],
  );
  return (
    <>
      <Heading title={review ? "内容审核" : "内容记录"}>
        {!review && (
          <Link className="primary-button" href={recordHref("content", "new")}>
            <Plus size={17} />
            登记内容
          </Link>
        )}
      </Heading>
      <div className="console-toolbar">
        <select
          aria-label="内容状态"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">全部状态</option>
          {[
            "pending",
            "approved",
            "returned",
            "rejected",
            "published",
            "withdrawn",
          ].map((v) => (
            <option key={v} value={v}>
              {short(v)}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <Message>{error}</Message>
      ) : !data ? (
        <Message>正在加载…</Message>
      ) : (
        <>
          <section className="console-card console-list">
            {data.items.length ? (
              data.items.map((row) => (
                <Link
                  key={row.id}
                  className="console-source-row"
                  href={recordHref("content", row.id)}
                >
                  <div>
                    <strong>{row.title}</strong>
                    <span>
                      {row.sourceName} · 版本 {row.version}
                    </span>
                  </div>
                  <Badge value={row.reviewStatus} />
                  <Badge value={row.publicationStatus} />
                </Link>
              ))
            ) : (
              <Message>
                {review ? "没有待审核内容。" : "暂无内容记录。"}
              </Message>
            )}
          </section>
          <Pagination
            offset={offset}
            total={data.total}
            limit={20}
            onChange={setOffset}
          />
        </>
      )}
    </>
  );
}
const emptyContent: ContentInput = {
  sourceId: "",
  title: "",
  url: "",
  body: "",
  kind: "knowledge",
  campusScope: "unknown",
  validUntil: null,
  publishedAt: null,
  extractedFields: {
    timeVerified: false,
    placeVerified: false,
    deadlineVerified: false,
  },
};
const localDate = (value: string | null | undefined) =>
  value
    ? new Date(value)
        .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", hour12: false })
        .replace(" ", "T")
        .slice(0, 16)
    : "";
const utcDate = (value: string) =>
  value ? new Date(value + ":00+08:00").toISOString() : null;
function ContentEditor({
  id,
  request,
  actor,
}: {
  id: string;
  request: Client;
  actor: ConsoleActor;
}) {
  const isNew = id === "new",
    router = useRouter(),
    { data, error, reload } = useLoad(
      () =>
        isNew ? Promise.resolve(null) : request<ContentDetail>("content/" + id),
      [id],
    );
  const [draft, setDraft] = useState<ContentInput | null>(null),
    [sourceQuery, setSourceQuery] = useState(""),
    [sourceOptions, setSourceOptions] = useState<SourceSummary[]>([]),
    [message, setMessage] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false),
    [withdraw, setWithdraw] = useState(false),
    [snapshot, setSnapshot] = useState<{
      input: ContentInput;
      version: number;
    } | null>(null);
  const form =
    draft ||
    (data
      ? {
          sourceId: data.sourceId,
          title: data.title,
          url: data.url,
          body: data.body,
          kind: data.kind,
          campusScope: data.campusScope,
          validUntil: data.validUntil,
          publishedAt: data.publishedAt,
          extractedFields: data.extractedFields,
        }
      : emptyContent);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      request<List<SourceSummary>>(
        "sources?limit=20&q=" + encodeURIComponent(sourceQuery),
      )
        .then((result) => {
          if (active) setSourceOptions(result.items);
        })
        .catch(() => {});
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [request, sourceQuery]);
  const set = <K extends keyof ContentInput>(name: K, value: ContentInput[K]) =>
    setDraft({ ...form, [name]: value });
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
      setMessage("已保存");
      setDraft(null);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作失败。");
    } finally {
      setBusy(false);
    }
  }
  async function inspectVersion(version: number) {
    setBusy(true);
    setMessage("");
    try {
      const result = await request<{ input: ContentInput }>(
        `content/${id}/versions/${version}`,
      );
      setSnapshot({ ...result, version });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "版本加载失败。");
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const result = await request<{ id: string }>(
        isNew ? "content" : "content/" + id,
        isNew ? "POST" : "PATCH",
        { ...form, ...command(data?.version || 0) },
      );
      if (isNew) router.replace(recordHref("content", result.id));
    });
  }
  if (error) return <Message>{error}</Message>;
  if (!isNew && !data) return <Message>正在加载…</Message>;
  const canWrite = actor.role !== "reviewer",
    canPublish = actor.role === "admin";
  return (
    <>
      <Link className="console-back" href="/admin/content">
        <ArrowLeft size={17} />
        内容记录
      </Link>
      <Heading title={isNew ? "登记内容" : data!.title}>
        {data && <Badge value={data.publicationStatus} />}
      </Heading>
      {message && (
        <p className="console-feedback" role="status">
          {message}
        </p>
      )}
      <form className="console-card console-form" onSubmit={save}>
        <label>
          查找信息源
          <input
            value={sourceQuery}
            onChange={(e) => setSourceQuery(e.target.value)}
            placeholder="名称或编号"
          />
        </label>
        <label>
          信息源
          <select
            required
            value={form.sourceId}
            onChange={(e) => set("sourceId", e.target.value)}
          >
            <option value="">请选择</option>
            {data && !sourceOptions.some((s) => s.id === data.sourceId) && (
              <option value={data.sourceId}>{data.sourceName}</option>
            )}
            {sourceOptions.map((source) => (
              <option key={source.id} value={source.id}>
                {source.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="console-wide">
          标题
          <input
            required
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={250}
          />
        </label>
        <label className="console-wide">
          原文链接
          <input
            required
            type="url"
            value={form.url}
            onChange={(e) => set("url", e.target.value)}
          />
        </label>
        <label>
          内容类型
          <select
            value={form.kind}
            onChange={(e) =>
              set("kind", e.target.value as ContentInput["kind"])
            }
          >
            <option value="knowledge">知识候选</option>
            <option value="event">活动候选</option>
          </select>
        </label>
        <label>
          校区
          <select
            value={form.campusScope}
            onChange={(e) =>
              set("campusScope", e.target.value as ContentInput["campusScope"])
            }
          >
            {[
              ["unknown", "待核实"],
              ["all", "全校"],
              ["university_town", "大学城"],
              ["baiyun", "白云山"],
              ["online", "线上"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          原文发布时间（北京时间）
          <input
            type="datetime-local"
            value={localDate(form.publishedAt)}
            onChange={(e) => set("publishedAt", utcDate(e.target.value))}
          />
        </label>
        <label>
          有效期至（北京时间）
          <input
            type="datetime-local"
            value={localDate(form.validUntil)}
            onChange={(e) => set("validUntil", utcDate(e.target.value))}
          />
        </label>
        <label className="console-wide">
          正文
          <textarea
            required
            rows={12}
            value={form.body}
            onChange={(e) => set("body", e.target.value)}
            maxLength={50000}
          />
        </label>
        {form.kind === "event" && (
          <fieldset className="console-wide console-event-fields">
            <legend>结构化字段与核验</legend>
            {[
              ["startAt", "开始时间"],
              ["endAt", "结束时间"],
              ["registrationDeadline", "报名截止"],
            ].map(([field, label]) => (
              <label key={field}>
                {label}（北京时间）
                <input
                  type="datetime-local"
                  value={localDate(form.extractedFields[field as "startAt"])}
                  onChange={(e) =>
                    set("extractedFields", {
                      ...form.extractedFields,
                      [field]: utcDate(e.target.value),
                    })
                  }
                />
              </label>
            ))}
            <label>
              地点编号
              <input
                value={form.extractedFields.placeId || ""}
                onChange={(e) =>
                  set("extractedFields", {
                    ...form.extractedFields,
                    placeId: e.target.value || null,
                  })
                }
              />
            </label>
            {[
              ["timeVerified", "时间已核验"],
              ["placeVerified", "校区地点已核验"],
              ["deadlineVerified", "截止日期已核验"],
            ].map(([field, label]) => (
              <label key={field} className="console-checkbox">
                <input
                  type="checkbox"
                  checked={!!form.extractedFields[field as "timeVerified"]}
                  onChange={(e) =>
                    set("extractedFields", {
                      ...form.extractedFields,
                      [field]: e.target.checked,
                    })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        <div className="console-actions console-wide">
          <button type="button" onClick={() => setPreview(!preview)}>
            {preview ? "收起预览" : "预览正文"}
          </button>
          <button className="primary-button" disabled={busy || !canWrite}>
            保存内容
          </button>
        </div>
        {preview && (
          <pre
            className="console-safe-preview console-wide"
            data-testid="content-safe-preview"
          >
            {form.body}
          </pre>
        )}
      </form>
      {data && (
        <>
          <section className="console-card">
            <h2>审核与发布</h2>
            <p>
              <Badge value={data.reviewStatus} /> · 版本 {data.version}
            </p>
            <External url={data.url} label="查看原文" />
            <label>
              审核说明
              <textarea
                aria-label="审核说明"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </label>
            <div className="console-actions">
              {[
                ["approved", "批准"],
                ["returned", "退回"],
                ["rejected", "拒绝"],
              ].map(([decision, label]) => (
                <button
                  key={decision}
                  disabled={busy || note.trim().length < 2}
                  onClick={() =>
                    void run(() =>
                      request("content/" + id + "/review", "POST", {
                        ...command(data.version),
                        decision,
                        note,
                      }),
                    )
                  }
                >
                  {label}
                </button>
              ))}
              <button
                className="primary-button"
                disabled={busy || !canPublish || note.trim().length < 2}
                onClick={() =>
                  void run(() =>
                    request("content/" + id + "/publish", "POST", {
                      ...command(data.version),
                      note,
                    }),
                  )
                }
              >
                发布
              </button>
              <button
                disabled={busy || !canPublish || note.trim().length < 2}
                onClick={() => setWithdraw(true)}
              >
                撤回
              </button>
            </div>
          </section>
          <section className="console-card">
            <h2>版本记录</h2>
            <div className="console-versions">
              {data.versions.map((version) => (
                <button
                  key={version.version}
                  disabled={busy}
                  onClick={() => void inspectVersion(version.version)}
                >
                  版本 {version.version} · {date(version.createdAt)}
                </button>
              ))}
            </div>
            {snapshot && (
              <>
                <h3>{snapshot.input.title}</h3>
                <pre className="console-safe-preview">
                  {snapshot.input.body}
                </pre>
                <button
                  disabled={busy || !canWrite}
                  onClick={() =>
                    void run(() =>
                      request(`content/${id}/restore`, "POST", {
                        ...command(data.version),
                        version: snapshot.version,
                      }),
                    )
                  }
                >
                  恢复为新版本
                </button>
              </>
            )}
          </section>
          <Confirm
            open={withdraw}
            onClose={() => setWithdraw(false)}
            title="撤回这条内容？"
            description="内容会停止公开，检索结果将同步失效。历史版本保留。"
            action="撤回"
            busy={busy}
            confirm={() =>
              void run(async () => {
                await request("content/" + id + "/withdraw", "POST", {
                  ...command(data.version),
                  note,
                });
                setWithdraw(false);
              })
            }
          />
        </>
      )}
    </>
  );
}
function Jobs({ request }: { request: Client }) {
  const [offset, setOffset] = useState(0),
    { data, error, reload } = useLoad(
      () =>
        request<
          List<{
            id: string;
            source_name: string;
            status: string;
            error_code: string | null;
            found_count: number;
            body_count: number;
            duplicate_count: number;
            version: number;
          }> & { collectorEnabled: false }
        >("jobs?offset=" + offset),
      [offset],
    );
  const [message, setMessage] = useState("");
  return (
    <>
      <Heading title="采集任务" />
      <section className="console-card">
        <Message>采集未启用</Message>
        <div className="console-actions">
          <button disabled>开始采集</button>
          <button disabled>重试任务</button>
        </div>
      </section>
      {message && <p role="status">{message}</p>}
      {error ? (
        <Message>{error}</Message>
      ) : !data ? (
        <Message>正在加载…</Message>
      ) : (
        <section className="console-card">
          {data.items.length ? (
            data.items.map((job) => (
              <article className="console-job" key={job.id}>
                <h2>{job.source_name}</h2>
                <p>
                  {job.status} · 发现 {job.found_count} · 正文 {job.body_count}{" "}
                  · 重复 {job.duplicate_count}
                </p>
                {job.error_code && <p>{job.error_code}</p>}
                {job.status === "queued" && (
                  <button
                    onClick={async () => {
                      try {
                        await request(
                          "jobs/" + job.id + "/cancel",
                          "POST",
                          command(job.version),
                        );
                        setMessage("已取消排队任务");
                        reload();
                      } catch (e) {
                        setMessage(
                          e instanceof Error ? e.message : "操作失败。",
                        );
                      }
                    }}
                  >
                    取消排队任务
                  </button>
                )}
              </article>
            ))
          ) : (
            <Message>暂无采集任务。</Message>
          )}
        </section>
      )}
      {data && data.items.length === 20 && (
        <Pagination offset={offset} limit={20} onChange={setOffset} />
      )}
    </>
  );
}
function Audit({ request }: { request: Client }) {
  const [offset, setOffset] = useState(0),
    { data, error } = useLoad(
      () =>
        request<
          List<{
            id: string;
            actor_label: string;
            action: string;
            target_type: string;
            target_id: string;
            version: number | null;
            created_at: string;
            details_json: string;
          }>
        >("audit?offset=" + offset),
      [offset],
    );
  return (
    <>
      <Heading title="审计日志" />
      {error ? (
        <Message>{error}</Message>
      ) : !data ? (
        <Message>正在加载…</Message>
      ) : (
        <>
          <section className="console-card console-list">
            {data.items.length ? (
              data.items.map((row) => (
                <article className="console-audit-row" key={row.id}>
                  <strong>{row.action}</strong>
                  <p>
                    {row.target_id}
                    {row.version ? " · 版本 " + row.version : ""}
                  </p>
                  {typeof JSON.parse(row.details_json || "{}").note ===
                    "string" && <p>{JSON.parse(row.details_json).note}</p>}
                  <span>
                    {row.actor_label} · {date(row.created_at)}
                  </span>
                </article>
              ))
            ) : (
              <Message>暂无管理员操作记录。</Message>
            )}
          </section>
          <Pagination
            offset={offset}
            limit={20}
            total={
              data.items.length < 20 ? offset + data.items.length : undefined
            }
            onChange={setOffset}
          />
        </>
      )}
    </>
  );
}
