"use client";
import { useEffect, useState, type FormEvent } from "react";
import { RefreshCw, Search, X } from "lucide-react";

type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type OfficialWebSource = {
  id: string;
  displayName: string;
  websiteUrl: string | null;
  enabled: boolean;
  operatingStatus: string;
  verificationStatus: string;
  officialStatus: string;
  permissionStatus: string;
  authorizationStatus: string;
  version: number;
  profileConfigured: boolean;
  entryUrls: string[];
  articlePathPrefixes: string[];
  profile: {
    configurationStatus: "discovered" | "verified";
    earliestImportDay?: string | null;
    latestImportDay?: string | null;
    titleSelector: string;
    titleSuffix: string;
    dateSelector: string;
    dateLabel: string;
    bodySelector: string;
    allowQueryUrls: boolean;
    requestIntervalMs: number;
  } | null;
  automatic: boolean;
  policyReady: boolean;
  policyRule: string | null;
  policyExpires: number | null;
  rightsScope: string | null;
  lastSuccessAt: string | null;
  lastExecutor: "cloud" | "local" | null;
  nextSyncAt: number | null;
  syncState: string;
  lastError: string | null;
};
type Settings = {
  version: number;
  sync_hours: number;
  auto_sync_enabled: number;
  earliest_import_day: string | null;
  runner_last_at: string | null;
  scheduler_last_at: string | null;
  cloud_runner_last_at: string | null;
  scheduler_result_json: string | null;
};
type Page = {
  items: OfficialWebSource[];
  total: number;
  allTotal: number;
  configuredTotal: number;
  readiness: {
    candidateTotal: number;
    missingProfileTotal: number;
    policyPendingTotal: number;
    sourcePendingTotal: number;
    activeJobTotal: number;
    readyTotal: number;
  };
  offset: number;
  limit: number;
  settings: Settings | null;
};
const intervals = [1, 3, 6, 12, 24];
const timestamp = (value: string | number | null) =>
  !value
    ? "—"
    : new Date(typeof value === "number" ? value : value).toLocaleString(
        "zh-CN",
        { timeZone: "Asia/Shanghai", hour12: false },
      );
const command = (expectedVersion: number) => ({
  commandId: crypto.randomUUID(),
  expectedVersion,
});
type SyncResult = {
  registered: number;
  state: string;
  retryAfterMs?: number;
  reason?: string;
  detail?: string;
};

async function requestManualSync(
  request: Client,
  body: { commandId: string; sourceId?: string },
  onRetry: (attempt: number) => void,
) {
  // The scheduler lease lasts thirty seconds, so a busy answer usually clears
  // within a couple of short waits. Two retries were not enough and made the
  // panel look like it had ignored the click.
  const MAX_RETRIES = 5;
  let attempt = 0;
  while (true) {
    const result = await request<SyncResult>("v2/sync", "POST", body);
    if (result.state !== "busy" || attempt >= MAX_RETRIES) return result;
    attempt++;
    onRetry(attempt);
    await new Promise((resolve) =>
      window.setTimeout(resolve, Math.min(result.retryAfterMs || 1200, 5000)),
    );
  }
}

function sourceCollectionBlock() {
  return "没有可启动任务：该官网或入口尚未核验，或已有任务正在采集";
}

function globalCollectionBlock() {
  return "没有新的已核验官网任务可启动；已在采集的来源不会重复登记";
}

function canCollectSource(source: OfficialWebSource) {
  return (
    source.enabled &&
    source.operatingStatus === "active" &&
    source.verificationStatus === "verified" &&
    source.officialStatus === "verified_official" &&
    source.profileConfigured &&
    source.profile?.configurationStatus !== "discovered"
  );
}

function useResource<T>(request: Client, path: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    path: string;
    revision: number;
    data?: T;
    error?: string;
  }>({ path: "", revision: -1 });
  useEffect(() => {
    let active = true;
    request<T>(path)
      .then((data) => {
        if (active) setState({ path, revision, data });
      })
      .catch((error) => {
        if (active)
          setState({
            path,
            revision,
            error: error instanceof Error ? error.message : "加载失败",
          });
      });
    return () => {
      active = false;
    };
  }, [path, request, revision]);
  return {
    data: state.path === path ? state.data : undefined,
    error: state.path === path ? state.error : undefined,
    reload: () => setRevision((value) => value + 1),
  };
}

export function OfficialWebCollectionPanel({
  request,
  admin,
}: {
  request: Client;
  admin: boolean;
}) {
  const [offset, setOffset] = useState(0),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [message, setMessage] = useState(""),
    [collectingAll, setCollectingAll] = useState(false);
  const params = new URLSearchParams({ limit: "50", offset: String(offset) });
  if (query) params.set("q", query);
  const path = "v2/web-collection?" + params.toString();
  const { data, error, reload } = useResource<Page>(request, path);
  useEffect(() => {
    const nextQuery = search.trim(),
      timeout = window.setTimeout(() => {
        if (nextQuery !== query) {
          setQuery(nextQuery);
          setOffset(0);
        }
      }, 1000);
    return () => window.clearTimeout(timeout);
  }, [query, search]);
  if (!data)
    return <p className="console-empty">{error || "正在加载官网采集…"}</p>;
  const settings = data.settings;
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    const form = new FormData(event.currentTarget);
    try {
      await request("v2/settings", "POST", {
        ...command(settings.version),
        syncHours: Number(form.get("hours")),
        autoSync: settings.auto_sync_enabled === 1,
        earliestImportDay: settings.earliest_import_day,
        note: "在官网采集模块调整统一间隔",
      });
      setMessage("已保存统一间隔");
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  }
  async function toggleAutomatic() {
    if (!settings) return;
    try {
      await request("v2/settings", "POST", {
        ...command(settings.version),
        syncHours: settings.sync_hours,
        autoSync: settings.auto_sync_enabled !== 1,
        earliestImportDay: settings.earliest_import_day,
        note:
          settings.auto_sync_enabled === 1
            ? "暂停官网自动采集"
            : "恢复官网自动采集",
      });
      setMessage(settings.auto_sync_enabled === 1 ? "已暂停" : "已恢复");
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    }
  }
  async function collectAll() {
    setCollectingAll(true);
    setMessage("");
    try {
      const result = await requestManualSync(
        request,
        { commandId: crypto.randomUUID() },
        (attempt) => setMessage(`调度器暂忙，自动重试 ${attempt}/5…`),
      );
      setMessage(
        result.registered > 0
          ? `已登记 ${result.registered} 个已核验官网采集任务，等待执行器处理`
          : result.state === "no_eligible_due_source"
            ? globalCollectionBlock()
            : result.state === "busy"
              ? "调度器仍在登记其他任务，请稍后重试"
              : result.state === "failed"
                ? `采集任务登记失败：${result.detail || result.reason || "未知错误"}`
                : "采集任务未登记，请刷新页面后重试",
      );
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "采集任务登记失败");
    } finally {
      setCollectingAll(false);
    }
  }
  return (
    <>
      <div className="console-heading">
        <h1>官网采集</h1>
        <button onClick={reload} aria-label="刷新官网采集">
          <RefreshCw size={18} />
        </button>
      </div>
      <section className="console-card">
        <div className="console-v2-source-status">
          <span>
            全站已配置入口 {data.configuredTotal} / {data.allTotal} 个官网
          </span>
          <span>
            云端执行器 {timestamp(settings?.cloud_runner_last_at || null)}
          </span>
          <span>本地执行器 {timestamp(settings?.runner_last_at || null)}</span>
        </div>
        <form
          className="console-actions console-web-global-controls"
          onSubmit={saveSettings}
        >
          <label>
            统一采集间隔
            <select
              name="hours"
              defaultValue={settings?.sync_hours || 24}
              disabled={!admin}
            >
              {intervals.map((hours) => (
                <option key={hours} value={hours}>
                  每 {hours} 小时
                </option>
              ))}
            </select>
          </label>
          <button disabled={!admin}>保存</button>
          <button
            type="button"
            disabled={!admin}
            onClick={() => void toggleAutomatic()}
          >
            {settings?.auto_sync_enabled === 1
              ? "暂停自动采集"
              : "恢复自动采集"}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!admin || collectingAll}
            onClick={() => void collectAll()}
          >
            {collectingAll ? "登记中…" : "立即采集"}
          </button>
        </form>
        {message && (
          <p className="console-feedback" role="status">
            {message}
          </p>
        )}
      </section>
      <section className="console-card">
        <div className="console-web-search">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="搜索官网"
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索官网"
          />
          {search && (
            <button
              type="button"
              className="console-web-search-clear"
              aria-label="清除搜索"
              onClick={() => {
                setSearch("");
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="console-v2-list">
          {data.items.map((source) => (
            <OfficialWebSourceRow
              key={source.id}
              source={source}
              request={request}
              admin={admin}
              reload={reload}
            />
          ))}
        </div>
        <div className="console-pagination">
          <span>{data.total} 个官网</span>
          <button
            disabled={offset <= 0}
            onClick={() => setOffset(Math.max(0, offset - data.limit))}
          >
            上一页
          </button>
          <button
            disabled={offset + data.limit >= data.total}
            onClick={() => setOffset(offset + data.limit)}
          >
            下一页
          </button>
        </div>
      </section>
    </>
  );
}

function OfficialWebSourceRow({
  source,
  request,
  admin,
  reload,
}: {
  source: OfficialWebSource;
  request: Client;
  admin: boolean;
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [editorOpen, setEditorOpen] = useState(false),
    [message, setMessage] = useState("");
  async function runNow() {
    setBusy(true);
    try {
      const result = await requestManualSync(
        request,
        { commandId: crypto.randomUUID(), sourceId: source.id },
        (attempt) => setMessage(`调度器暂忙，自动重试 ${attempt}/5…`),
      );
      setMessage(
        result.registered > 0
          ? "已登记该已核验官网采集任务，等待执行器处理"
          : result.state === "no_eligible_due_source"
            ? sourceCollectionBlock()
            : result.state === "busy"
              ? "调度器仍在登记其他任务，请稍后重试"
              : "未能登记采集任务，请刷新后重试",
      );
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  const syncStateLabels: Record<string, string> = {
    not_configured: "待配置",
    ready: "等待采集",
    queued: "排队中",
    running: "采集中",
    completed: "已完成",
    failed: "失败",
    blocked: "已阻止",
    offline: "离线",
  };
  return (
    <article className="console-source-row console-web-source-row">
      <div className="console-web-source-main">
        <div className="console-web-source-heading">
          <strong>{source.displayName}</strong>
          <span className="console-web-source-url">
            {source.websiteUrl || "未登记官网地址"}
          </span>
        </div>
        <div className="console-web-source-status">
          <span
            className={
              "console-badge " +
              (source.enabled
                ? "console-status-approved"
                : "console-status-pending")
            }
          >
            {source.enabled ? "启用" : "停运"}
          </span>
          <span className="console-badge">
            {source.profileConfigured
              ? `${source.entryUrls.length} 个入口`
              : "未配置入口"}
          </span>
          <span className="console-badge">
            {syncStateLabels[source.syncState] || source.syncState}
          </span>
        </div>
      </div>
      <div className="console-web-source-side">
        <dl className="console-web-source-times">
          <div>
            <dt>最近成功</dt>
            <dd>
              {timestamp(source.lastSuccessAt)}
              {source.lastExecutor
                ? ` · ${source.lastExecutor === "cloud" ? "云端" : "本地"}`
                : ""}
            </dd>
          </div>
          <div>
            <dt>下次计划</dt>
            <dd>{timestamp(source.nextSyncAt)}</dd>
          </div>
        </dl>
        <div className="console-web-source-actions">
          <button
            type="button"
            disabled={!admin}
            onClick={() => setEditorOpen((open) => !open)}
          >
            {editorOpen ? "收起" : "配置入口"}
          </button>
          <button
            type="button"
            disabled={!admin || busy || !canCollectSource(source)}
            title={
              canCollectSource(source)
                ? undefined
                : "只采集已核验且入口已确认的官网"
            }
            onClick={() => void runNow()}
          >
            立即采集
          </button>
        </div>
      </div>
      {source.lastError && (
        <p className="console-web-source-error" role="status">
          {source.lastError}
        </p>
      )}
      {message && (
        <p className="console-web-source-message" role="status">
          {message}
        </p>
      )}
      {editorOpen && (
        <div className="console-web-source-editor">
          <ProfileEditor
            source={source}
            request={request}
            admin={admin}
            reload={reload}
          />
        </div>
      )}
    </article>
  );
}

function ProfileEditor({
  source,
  request,
  admin,
  reload,
}: {
  source: OfficialWebSource;
  request: Client;
  admin: boolean;
  reload: () => void;
}) {
  const [message, setMessage] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      entryUrls = String(form.get("entryUrls"))
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
      articlePathPrefixes = String(form.get("articlePathPrefixes"))
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
    try {
      await request("v2/web-collection/" + source.id + "/profile", "POST", {
        ...command(source.version),
        configurationStatus: "verified",
        earliestImportDay:
          String(form.get("earliestImportDay") || "") || undefined,
        latestImportDay: String(form.get("latestImportDay") || "") || undefined,
        entryUrls,
        articlePathPrefixes,
        titleSelector: String(form.get("titleSelector")),
        titleSuffix: String(form.get("titleSuffix")),
        dateSelector: String(form.get("dateSelector")),
        dateLabel: String(form.get("dateLabel")),
        bodySelector: String(form.get("bodySelector")),
        allowQueryUrls: form.get("allowQueryUrls") === "on",
        requestIntervalMs: source.profile?.requestIntervalMs ?? 1000,
      });
      setMessage("入口规则已保存");
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  }
  return (
    <form className="console-form" onSubmit={save}>
      <label>
        文章栏目入口（每行一个）
        <textarea
          name="entryUrls"
          required
          defaultValue={source.entryUrls.join("\n")}
          placeholder="https://example.edu.cn/news/list.htm"
        />
      </label>
      <label>
        文章路径前缀（每行一个）
        <textarea
          name="articlePathPrefixes"
          required
          defaultValue={source.articlePathPrefixes.join("\n")}
          placeholder="/info/1005/"
        />
      </label>
      <div className="console-form-row">
        <label>
          最早发布日期
          <input
            type="date"
            name="earliestImportDay"
            defaultValue={source.profile?.earliestImportDay || ""}
          />
        </label>
        <label>
          最晚发布日期
          <input
            type="date"
            name="latestImportDay"
            defaultValue={source.profile?.latestImportDay || ""}
          />
        </label>
      </div>
      <label>
        标题选择器
        <input
          name="titleSelector"
          required
          defaultValue={source.profile?.titleSelector || "h1, title"}
        />
      </label>
      <label>
        标题后缀
        <input
          name="titleSuffix"
          defaultValue={source.profile?.titleSuffix || ""}
        />
      </label>
      <label>
        发布时间选择器
        <input
          name="dateSelector"
          required
          defaultValue={source.profile?.dateSelector || "time, .date, .time"}
        />
      </label>
      <label>
        发布时间标签
        <input
          name="dateLabel"
          required
          defaultValue={source.profile?.dateLabel || "发布时间"}
        />
      </label>
      <label>
        正文选择器
        <input
          name="bodySelector"
          required
          defaultValue={source.profile?.bodySelector || "article, main"}
        />
      </label>
      <label>
        <input
          type="checkbox"
          name="allowQueryUrls"
          defaultChecked={source.profile?.allowQueryUrls || false}
        />
        允许文章链接携带查询参数
      </label>
      <button disabled={!admin}>保存采集规则</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
