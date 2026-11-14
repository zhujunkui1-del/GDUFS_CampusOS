"use client";
import Link from "next/link";
import { ManualImportForm } from "./manual-import-form";
import { ConsoleV2Workspace, ConsoleV2Filters } from "./v2-workspace";
import {
  deriveConsoleCredential,
  type ConsoleCredentialDerivation,
} from "@/domain/console/credential";
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
  RefreshCw,
  Archive,
  ShieldCheck,
  LogOut,
  Plus,
  Search,
  MessageCirclePlus,
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
import {
  radarCategories,
  knowledgeCategories,
  contentTypeNames,
  topicNames,
} from "@/domain/console/taxonomy";

type Auth = {
  credentialDerivation?: ConsoleCredentialDerivation;
  authenticated: boolean;
  mode: "local" | "key" | "access";
  actor?: ConsoleActor;
  csrf?: string;
  environment?: string;
};
type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
// Reads stay snappy; a whole-site registration is allowed to take longer
// because it writes one job per official website.
const REQUEST_TIMEOUT_MS = 15000;
const WRITE_TIMEOUT_MS = 90000;
type List<T> = { items: T[]; total?: number; offset: number; limit: number };
const navigation = [
  { id: "", label: "总览", icon: LayoutDashboard },
  { id: "sources", label: "信息源", icon: Library },
  { id: "articles", label: "文章", icon: ClipboardCheck },
  { id: "web-collection", label: "官网采集", icon: RefreshCw },
  { id: "collector", label: "公众号采集", icon: RefreshCw },
  { id: "retention", label: "过时信息清理", icon: Archive },
  { id: "whitelist", label: "白名单", icon: ShieldCheck },
  { id: "feedback", label: "反馈", icon: MessageCirclePlus },
];
const date = (value: string | null | undefined) =>
  value
    ? value.length === 10
      ? value
      : new Date(value).toLocaleString("zh-CN", {
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
  const router = useRouter();
  const pathname = usePathname(),
    parts = pathname.split("/").filter(Boolean).slice(1),
    section = parts[0] || "",
    id = useSearchParams().get("record");
  useEffect(() => {
    if (section === "reviews") router.replace("/admin/articles");
    if (section === "jobs") router.replace("/admin/web-collection?view=jobs");
    if (section === "audit") router.replace("/admin?view=history");
    if (section === "content")
      router.replace(
        id === "new"
          ? "/admin/sources?view=import"
          : id
            ? "/admin/sources?article=" + encodeURIComponent(id)
            : "/admin/sources",
      );
  }, [section, id, router]);
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
      const consolePath = path.startsWith("/api/")
        ? path
        : "/api/admin/" + path;
      let response: Response;
      try {
        response = await fetch(consolePath, {
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
          // A whole-site sweep writes one job per source, so it can take
          // longer than a normal panel read. Timing it out at fifteen seconds
          // cancelled the request while the worker kept registering, which
          // showed up as a raw English "signal timed out" toast.
          signal: AbortSignal.timeout(
            method === "GET" ? REQUEST_TIMEOUT_MS : WRITE_TIMEOUT_MS,
          ),
        });
      } catch (failure) {
        if (failure instanceof DOMException && failure.name === "TimeoutError")
          throw Error("请求超时，服务器仍在处理，请稍后刷新查看结果。");
        throw failure;
      }
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
                  credentialDerivation: previous.credentialDerivation,
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
      const setup = await request<Auth>("/api/console-auth");
      const presented = setup.credentialDerivation
        ? await deriveConsoleCredential(key, setup.credentialDerivation)
        : key;
      const next = await request<Auth>("/api/console-auth", "POST", {
        key: presented,
      });
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
        credentialDerivation: auth?.credentialDerivation,
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
          ) : auth?.mode === "local" || auth?.mode === "key" ? (
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
          {error && (auth?.mode === "local" || auth?.mode === "key") && (
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
          <span>{auth.actor?.email.replace(/^(.{2}).+(@)/, "$1•••$2")}</span>
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
          <ConsoleV2Workspace
            section={section}
            id={id}
            request={request}
            actor={auth.actor!}
            Dialog={Confirm}
            article={(id) => (
              <ContentEditor
                key={id}
                id={id}
                request={request}
                actor={auth.actor!}
              />
            )}
            jobs={(sourceId) => <Jobs request={request} sourceId={sourceId} />}
            history={(sourceId) => (
              <Audit request={request} sourceId={sourceId} />
            )}
            advancedSource={(id) => (
              <SourceEditor id={id} request={request} actor={auth.actor!} />
            )}
            manualImport={() => (
              <ManualImportForm request={request} actor={auth.actor!} />
            )}
          />
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
export function Overview({ request }: { request: Client }) {
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
            <Message>
              {data.collectorEnabled ? "手动采集已就绪" : "采集未启用"}
            </Message>
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
export function Sources({ request }: { request: Client }) {
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
  campusScope: "all",
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
                {data.connectorType === "official_web" && data.enabled && (
                  <button
                    disabled={busy || !write}
                    onClick={() =>
                      void run(() =>
                        request("jobs", "POST", {
                          commandId: crypto.randomUUID(),
                          sourceId: id,
                          maxArticles: 1,
                        }),
                      )
                    }
                  >
                    创建采集任务
                  </button>
                )}
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
    [note, setNote] = useState(""),
    [official, setOfficial] = useState<string>(source.officialStatus),
    [permission, setPermission] = useState<string>(source.permissionStatus),
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
export function ContentList({
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
                  <Badge value={row.publicationState} />
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
  bodyStatus: "unknown",
  kind: "knowledge",
  campusScope: "all",
  validUntil: null,
  publishedAt: null,
  sourceUpdatedAt: null,
  contentType: "unknown",
  rightsScope: "unknown",
  radarCategory: null,
  knowledgeCategory: null,
  publisher: null,
  summary: "",
  tags: [],
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
function ContentEditor(props: {
  id: string;
  request: Client;
  actor: ConsoleActor;
}) {
  return props.id === "new" ? (
    <ManualImportForm request={props.request} actor={props.actor} />
  ) : (
    <ExistingContentEditor {...props} />
  );
}
function ExistingContentEditor({
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
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false);
  const form =
    draft ||
    (data
      ? {
          sourceId: data.sourceId,
          title: data.title,
          url: data.url,
          body: data.body,
          bodyStatus: data.bodyStatus,
          kind: data.kind,
          campusScope: data.campusScope,
          validUntil: data.validUntil,
          publishedAt: data.publishedAt,
          sourceUpdatedAt: data.sourceUpdatedAt,
          contentType: data.contentType,
          rightsScope: data.rightsScope,
          radarCategory: data.radarCategory,
          knowledgeCategory: data.knowledgeCategory,
          publisher: data.publisher,
          summary: data.summary,
          tags: data.tags,
          extractedFields: data.extractedFields,
        }
      : emptyContent);
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
  async function save(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const classificationOnly =
        data &&
        Object.keys(form).every(
          (k) =>
            ["radarCategory", "knowledgeCategory"].includes(k) ||
            JSON.stringify(form[k as keyof ContentInput]) ===
              JSON.stringify(data[k as keyof ContentDetail]),
        );
      const result = await request<{ id: string }>(
        classificationOnly
          ? "v2/classify/" + id
          : isNew
            ? "content"
            : "content/" + id,
        classificationOnly || isNew ? "POST" : "PATCH",
        {
          ...(classificationOnly
            ? {
                radarCategory: form.radarCategory,
                knowledgeCategory: form.knowledgeCategory,
              }
            : form),
          ...command(data?.version || 0),
        },
      );
      if (isNew) router.replace(recordHref("content", result.id));
    });
  }
  if (error) return <Message>{error}</Message>;
  if (!isNew && !data) return <Message>正在加载…</Message>;
  const canWrite = actor.role !== "reviewer",
    canPublish = actor.role === "admin";
  if (data?.collectionManaged)
    return (
      <>
        <Heading title={data.title} />
        <section className="console-card">
          <h2>采集文章</h2>
          <p>
            此文章由公众号采集程序维护，成功采集后自动发布，后续更新覆盖当前阅读版。
          </p>
          <dl className="console-details">
            <dt>来源</dt>
            <dd>{data.sourceName}</dd>
            <dt>原文发布</dt>
            <dd>{date(data.publishedAt)}</dd>
            <dt>最近采集</dt>
            <dd>{date(data.fetchedAt)}</dd>
          </dl>
          <div className="console-actions">
            <Link className="text-link" href={"/articles/" + data.id}>
              站内阅读
            </Link>
            <External url={data.url} label="查看原文" />
            <Link href="/admin/collector">采集设置</Link>
          </div>
        </section>
      </>
    );
  return (
    <>
      <Heading title={isNew ? "登记内容" : data!.title}>
        {data && (
          <>
            <Badge value={data.publicationState} />
            <Link
              className="text-link console-article-whitelist"
              href={"/admin/whitelist?type=document&target=" + id}
            >
              加入白名单
            </Link>
          </>
        )}
      </Heading>
      {data?.duplicateOf && (
        <Link
          className="text-link"
          href={recordHref("content", data.duplicateOf)}
        >
          查看可能重复的原文记录
        </Link>
      )}
      {data && (
        <dl className="console-card console-details">
          <dt>原文发布</dt>
          <dd>{date(data.publishedAt)}</dd>
          <dt>获取时间</dt>
          <dd>{date(data.fetchedAt)}</dd>
          <dt>原文更新</dt>
          <dd>{date(data.sourceUpdatedAt)}</dd>
          <dt>记录更新</dt>
          <dd>{date(data.updatedAt)}</dd>
        </dl>
      )}
      {!!data?.discoveries?.length && (
        <section className="console-card">
          <h2>发现出处</h2>
          {data.discoveries.map((entry, i) => (
            <p key={i}>
              <External url={entry.entryUrl} />
            </p>
          ))}
        </section>
      )}
      {!!data?.timeEvidence?.length && (
        <section className="console-card">
          <h2>时间证据</h2>
          {data.timeEvidence.map((e, i) => (
            <article key={i} className="console-job">
              <blockquote>{e.rawText}</blockquote>
              <dl className="console-details">
                <dt>字段</dt>
                <dd>{e.field}</dd>
                <dt>日期 / 时刻</dt>
                <dd>
                  {e.date || "未知"} / {e.time || "未知"}
                </dd>
                <dt>精度</dt>
                <dd>{e.precision}</dd>
                <dt>输入版本 / 修订</dt>
                <dd>
                  {e.snapshotVersion} / {e.contentRevision}
                </dd>
                <dt>核验</dt>
                <dd>
                  {e.verificationStatus === "pending"
                    ? "待核验"
                    : e.verificationStatus}
                </dd>
              </dl>
            </article>
          ))}
        </section>
      )}
      {!!data?.eventCandidates?.length && (
        <section className="console-card">
          <h2>活动提取候选</h2>
          {data.eventCandidates.map((event) => (
            <article key={event.id}>
              <h3>{event.title}</h3>
              <dl className="console-details">
                <dt>主办方</dt>
                <dd>{event.organizer || "待核实"}</dd>
                <dt>开始</dt>
                <dd>{date(event.startsAt)}</dd>
                <dt>结束</dt>
                <dd>{date(event.endsAt)}</dd>
                <dt>报名截止</dt>
                <dd>{date(event.registrationDeadline)}</dd>
                <dt>地点</dt>
                <dd>{event.rawPlaceName || "待核实"}</dd>
              </dl>
              <Badge value={event.verificationStatus} />
            </article>
          ))}
        </section>
      )}
      {message && (
        <p className="console-feedback" role="status">
          {message}
        </p>
      )}
      <form className="console-card console-form" onSubmit={save}>
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
          原文类型
          <select
            value={form.contentType}
            onChange={(e) => set("contentType", e.target.value)}
          >
            {Object.entries(contentTypeNames).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          一级分类
          <select
            value={form.radarCategory ? "radar" : "knowledge"}
            onChange={(e) =>
              setDraft({
                ...form,
                radarCategory:
                  e.target.value === "radar" ? "campus_notice" : null,
                knowledgeCategory:
                  e.target.value === "knowledge"
                    ? "administrative_services"
                    : null,
              })
            }
          >
            <option value="radar">校园雷达</option>
            <option value="knowledge">校园知识</option>
          </select>
        </label>
        <label>
          二级分类
          <select
            required
            value={form.radarCategory || form.knowledgeCategory || ""}
            onChange={(e) =>
              setDraft({
                ...form,
                radarCategory: form.radarCategory ? e.target.value : null,
                knowledgeCategory: form.radarCategory ? null : e.target.value,
              })
            }
          >
            <option value="" disabled>
              请选择
            </option>
            {(form.radarCategory ? radarCategories : knowledgeCategories).map(
              (x) => (
                <option key={x.code} value={x.code}>
                  {x.label}
                </option>
              ),
            )}
          </select>
        </label>
        <fieldset className="console-wide">
          <legend>辅助主题</legend>
          {topicNames.map((tag) => (
            <label className="console-checkbox" key={tag}>
              <input
                type="checkbox"
                checked={form.tags.includes(tag)}
                onChange={(e) =>
                  set(
                    "tags",
                    e.target.checked
                      ? [...form.tags, tag]
                      : form.tags.filter((x) => x !== tag),
                  )
                }
              />
              {tag}
            </label>
          ))}
        </fieldset>
        <label className="console-wide">
          摘要
          <textarea
            value={form.summary}
            onChange={(e) => set("summary", e.target.value)}
            maxLength={500}
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
              ["placeVerified", "地点已核验"],
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
            <h2>发布状态</h2>
            <p>
              <Badge value={data.publicationState} />
            </p>
            <External url={data.url} label="查看原文" />
            <div className="console-actions">
              <button
                className="primary-button"
                disabled={busy || !canPublish}
                onClick={() =>
                  void run(() =>
                    request("content/" + id + "/publish", "POST", {
                      ...command(data.version),
                    }),
                  )
                }
              >
                发布
              </button>
              <button
                disabled={busy || !canPublish}
                onClick={() =>
                  void run(() =>
                    request(
                      "content/" + id + "/withdraw",
                      "POST",
                      command(data.version),
                    ),
                  )
                }
              >
                撤回
              </button>
            </div>
          </section>
        </>
      )}
    </>
  );
}
function Jobs({ request, sourceId }: { request: Client; sourceId?: string }) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0),
    { data, error, reload } = useLoad(
      () =>
        request<
          List<{
            id: string;
            source_name: string;
            status: string;
            control_state: string;
            phase: string;
            error_code: string | null;
            found_count: number;
            body_count: number;
            duplicate_count: number;
            skipped_count?: number;
            version: number;
          }> & { collectorEnabled: boolean }
        >(
          (sourceId
            ? "v2/sources/" + sourceId + "/jobs"
            : "v2/operations/jobs") +
            "?" +
            new URLSearchParams({ ...filters, offset: String(offset) }),
        ),
      [offset, sourceId, filters],
    );
  const [message, setMessage] = useState("");
  return (
    <>
      <Heading title="采集任务" />
      <ConsoleV2Filters
        fields={[
          { name: "q", label: "查找任务" },
          {
            name: "status",
            label: "执行状态",
            options: [
              ["queued", "待运行"],
              ["running", "运行中"],
              ["completed", "完成"],
              ["failed", "异常"],
            ],
          },
          { name: "from", label: "创建起日", type: "date" },
          { name: "to", label: "创建止日", type: "date" },
          {
            name: "sort",
            label: "排序",
            options: [
              ["time", "创建时间"],
              ["status", "状态"],
              ["target", "任务编号"],
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
        }}
      />
      <section className="console-card">
        <Message>
          {data?.collectorEnabled ? "受控采集任务" : "正在加载…"}
        </Message>
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
                  {job.control_state === "paused"
                    ? "已暂停"
                    : job.control_state === "cancelled"
                      ? "已取消"
                      : {
                          queued: "等待执行",
                          running: "执行中",
                          completed: "已完成",
                          failed: "未完成",
                        }[job.status] || job.status}{" "}
                  · 发现 {job.found_count} · 文本解析 {job.body_count} · 重复{" "}
                  {job.duplicate_count} · 旧文跳过 {job.skipped_count || 0}
                </p>
                {job.error_code && <p>{job.error_code}</p>}
                {job.phase !== "complete" &&
                  job.control_state !== "cancelled" && (
                    <div className="console-actions">
                      {[
                        job.control_state === "paused" ? "resume" : "pause",
                        "cancel",
                      ].map((action) => (
                        <button
                          key={action}
                          onClick={async () => {
                            try {
                              await request(
                                "jobs/" + job.id + "/" + action,
                                "POST",
                                command(job.version),
                              );
                              setMessage(
                                action === "cancel"
                                  ? "已取消任务"
                                  : action === "pause"
                                    ? "已暂停任务"
                                    : "任务已恢复排队",
                              );
                              reload();
                            } catch (e) {
                              setMessage(
                                e instanceof Error ? e.message : "操作失败。",
                              );
                            }
                          }}
                        >
                          {action === "cancel"
                            ? "取消任务"
                            : action === "pause"
                              ? "暂停任务"
                              : "恢复任务"}
                        </button>
                      ))}
                    </div>
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
function Audit({ request, sourceId }: { request: Client; sourceId?: string }) {
  const [filters, setFilters] = useState<Record<string, string>>({});
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
        >(
          (sourceId
            ? "v2/sources/" + sourceId + "/history"
            : "v2/operations/history") +
            "?" +
            new URLSearchParams({ ...filters, offset: String(offset) }),
        ),
      [offset, sourceId, filters],
    );
  return (
    <>
      <ConsoleV2Filters
        fields={[
          { name: "q", label: "查找操作或对象" },
          { name: "from", label: "操作起日", type: "date" },
          { name: "to", label: "操作止日", type: "date" },
          {
            name: "sort",
            label: "排序",
            options: [
              ["time", "操作时间"],
              ["status", "操作类型"],
              ["target", "对象编号"],
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
        }}
      />
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
