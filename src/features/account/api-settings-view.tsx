"use client";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Power,
  Trash2,
  XCircle,
} from "lucide-react";
import { MODEL_PROVIDERS, providerById } from "@/domain/models/providers";
import { accountRequest, useAccount } from "./account-context";

type ConfigStatus = "untested" | "connected" | "failed" | "disabled";
type SavedConfig = {
  id: string;
  displayName: string;
  provider: string;
  protocol: "openai" | "anthropic" | "gemini";
  baseUrl: string;
  model: string;
  keyHint: string;
  status: ConfigStatus;
  lastError: string | null;
  testedAt: string | null;
  updatedAt: string;
  active: boolean;
};
type ListPayload = {
  configs: SavedConfig[];
  mode: "platform" | "personal";
  activeConfigId: string | null;
};

const STATUS_LABEL: Record<ConfigStatus, string> = {
  untested: "未测试",
  connected: "已连接",
  failed: "连接失败",
  disabled: "已禁用",
};

export function ApiSettingsView() {
  const account = useAccount();
  const user = account.session?.user;
  return (
    <div className="account-api-layout">
      <section className="account-card account-api-card">
        <div className="account-api-heading">
          <span className="account-row-icon">
            <KeyRound size={22} strokeWidth={1.8} />
          </span>
          <div>
            <h2>个人 API 设置</h2>
            <p>
              使用你自己的模型密钥。密钥只会加密保存在当前账号，不写入日志、不返回浏览器；平台默认模型不受影响。
            </p>
          </div>
        </div>
        <ApiSettings loggedIn={!!user} />
      </section>
    </div>
  );
}

function ApiSettings({ loggedIn }: { loggedIn: boolean }) {
  const [configs, setConfigs] = useState<SavedConfig[]>([]);
  const [mode, setMode] = useState<"platform" | "personal">("platform");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [provider, setProvider] = useState("deepseek");
  const [protocol, setProtocol] = useState<"openai" | "anthropic" | "gemini">(
    "openai",
  );
  const [baseUrl, setBaseUrl] = useState(providerById("deepseek")?.baseUrl || "");
  const [model, setModel] = useState(providerById("deepseek")?.model || "");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draftTested, setDraftTested] = useState(false);
  const [testLatencyMs, setTestLatencyMs] = useState<number | null>(null);

  const preset = providerById(provider);

  function invalidateTest() {
    setDraftTested(false);
    setTestLatencyMs(null);
  }

  async function refresh() {
    if (!loggedIn) return;
    const data = await accountRequest<ListPayload>(
      "/api/me/model-configs",
      undefined,
      "GET",
    );
    setConfigs(data.configs);
    setMode(data.mode);
  }

  useEffect(() => {
    let cancelled = false;
    if (!loggedIn) return;
    void accountRequest<ListPayload>("/api/me/model-configs", undefined, "GET")
      .then((data) => {
        if (cancelled) return;
        setConfigs(data.configs);
        setMode(data.mode);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "读取模型配置失败。");
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  function resetForm(nextProvider = provider) {
    const next = providerById(nextProvider);
    setDisplayName(next?.label || "我的模型");
    setBaseUrl(next?.baseUrl || "");
    setModel(next?.model || "");
    setProtocol(next?.protocol || "openai");
    setApiKey("");
    setShowKey(false);
    setError("");
    setMessage("");
    invalidateTest();
  }

  function startNew() {
    setEditingId(null);
    setFormOpen(true);
    resetForm("deepseek");
    setDisplayName("");
  }

  function startEdit(config: SavedConfig) {
    setEditingId(config.id);
    setFormOpen(true);
    setDisplayName(config.displayName);
    setProvider(config.provider);
    setProtocol(config.protocol);
    setBaseUrl(config.baseUrl);
    setModel(config.model);
    setApiKey("");
    setShowKey(false);
    setError("");
    setMessage("");
    invalidateTest();
  }

  function chooseProvider(id: string) {
    setProvider(id);
    const next = providerById(id);
    setProtocol(next?.protocol || "openai");
    setBaseUrl(next?.baseUrl || "");
    setModel(next?.model || "");
    setApiKey("");
    if (!editingId) setDisplayName(next?.label || "");
    invalidateTest();
  }

  function validateDraft() {
    if (!displayName.trim()) return "请给这份配置起个名字。";
    if (!baseUrl.trim() || !model.trim()) return "请填写接入地址和模型名。";
    if (!editingId && !apiKey.trim()) return "请填写 API Key。";
    return "";
  }

  async function testDraft() {
    if (busy) return;
    const invalid = validateDraft();
    if (invalid) return setError(invalid);
    setBusy("test-draft");
    setError("");
    setMessage("");
    invalidateTest();
    try {
      if (!loggedIn) {
        const result = await accountRequest<{ ok: true; latencyMs: number }>(
          "/api/model-settings/test",
          { provider, baseUrl, model, apiKey },
          "POST",
        );
        setTestLatencyMs(result.latencyMs);
        setDraftTested(true);
        setMessage(
          `连接成功（${result.latencyMs} ms）。游客测试不会保存密钥，登录后可以保存并启用。`,
        );
        return;
      }
      const result = await accountRequest<{ ok: true; latencyMs: number }>(
        "/api/me/model-configs",
        {
          action: "test-draft",
          id: editingId || undefined,
          displayName,
          provider,
          protocol,
          baseUrl,
          model,
          apiKey,
        },
        "PATCH",
      );
      setTestLatencyMs(result.latencyMs);
      setDraftTested(true);
      setMessage(`连接成功（${result.latencyMs} ms）。现在可以保存了。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接测试失败，请检查配置。");
    } finally {
      setBusy("");
    }
  }

  async function saveConfig() {
    if (busy) return;
    const invalid = validateDraft();
    if (invalid) return setError(invalid);
    if (!draftTested)
      return setError("请先测试连接，测试通过后才能保存。");
    setBusy("save");
    setError("");
    setMessage("");
    try {
      let id = editingId;
      if (id) {
        await accountRequest(
          "/api/me/model-configs",
          {
            action: "update",
            id,
            displayName,
            provider,
            protocol,
            baseUrl,
            model,
            apiKey,
          },
          "PATCH",
        );
      } else {
        const created = await accountRequest<{ config: SavedConfig }>(
          "/api/me/model-configs",
          { displayName, provider, protocol, baseUrl, model, apiKey },
          "POST",
        );
        id = created.config.id;
        setEditingId(id);
      }
      setMessage(
        testLatencyMs
          ? `已保存并测试通过（${testLatencyMs} ms）。`
          : "已保存。",
      );
      invalidateTest();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试。");
      await refresh().catch(() => undefined);
    } finally {
      setBusy("");
    }
  }

  async function action(name: "test" | "activate" | "disable" | "delete", id: string) {
    if (busy) return;
    setBusy(`${name}:${id}`);
    setError("");
    setMessage("");
    try {
      if (name === "delete") {
        await accountRequest("/api/me/model-configs", { id }, "DELETE");
        if (editingId === id) {
          setEditingId(null);
          setFormOpen(false);
        }
        setMessage("已删除配置。若删的是当前配置，Agent 会提示重新选择，不会自动回平台。");
      } else {
        const result = await accountRequest<{ latencyMs?: number }>(
          "/api/me/model-configs",
          { action: name, id },
          "PATCH",
        );
        if (name === "test")
          setMessage(`连接成功（${result.latencyMs ?? 0} ms）。`);
        if (name === "activate") setMessage("已设为当前模型。");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
      await refresh().catch(() => undefined);
    } finally {
      setBusy("");
    }
  }

  async function selectPlatform() {
    if (busy) return;
    setBusy("platform");
    try {
      await accountRequest("/api/me/model-configs", { action: "platform" }, "PATCH");
      setMode("platform");
      setMessage("已切换回平台默认模型。");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "切换失败。");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      {!loggedIn && (
        <p className="account-api-note" role="status">
          游客模式：可以测试连接，但不会保存任何密钥；关闭页面后全部丢弃。
        </p>
      )}
      <div className="account-api-current">
        <div>
          <strong>当前使用：</strong>
          {mode === "platform" ? (
            <span>平台默认模型</span>
          ) : (
            <span>
              {configs.find((item) => item.active)?.displayName || "个人模型（待选择）"}
            </span>
          )}
        </div>
        {loggedIn && (
          <button
            type="button"
            onClick={() => void selectPlatform()}
            disabled={busy !== ""}
          >
            切回平台
          </button>
        )}
      </div>

      {!loggedIn && !formOpen && (
        <button type="button" className="account-api-add" onClick={startNew}>
          <Plus size={16} /> 测试一个模型连接
        </button>
      )}

      {loggedIn && (
        <div className="account-api-list">
          {configs.length === 0 && (
            <p className="account-api-empty">还没有个人配置。新增一份，测试通过后可启用。</p>
          )}
          {configs.map((config) => (
            <article className="account-api-item" key={config.id}>
              <div className="account-api-item-main">
                <header>
                  <strong>{config.displayName}</strong>
                  {config.active && mode === "personal" && <em>当前</em>}
                  <span className={`account-api-status is-${config.status}`}>
                    {STATUS_LABEL[config.status]}
                  </span>
                </header>
                <p>
                  {providerById(config.provider)?.label || config.provider} ·{" "}
                  {config.model}
                </p>
                <p className="account-api-hint">
                  密钥 {config.keyHint}
                  {config.lastError ? ` · ${config.lastError}` : ""}
                </p>
              </div>
              <div className="account-api-item-actions">
                <button
                  type="button"
                  onClick={() => void action("test", config.id)}
                  disabled={busy !== ""}
                >
                  {busy === `test:${config.id}` ? <Loader2 size={14} /> : null}
                  测试
                </button>
                {config.status === "connected" && !config.active && (
                  <button
                    type="button"
                    onClick={() => void action("activate", config.id)}
                    disabled={busy !== ""}
                  >
                    <Power size={14} /> 启用
                  </button>
                )}
                <button type="button" onClick={() => startEdit(config)}>
                  <Pencil size={14} /> 编辑
                </button>
                <button
                  type="button"
                  onClick={() => void action("delete", config.id)}
                  disabled={busy !== ""}
                >
                  <Trash2 size={14} /> 删除
                </button>
              </div>
            </article>
          ))}
          <button type="button" className="account-api-add" onClick={startNew}>
            <Plus size={16} /> 新增配置
          </button>
        </div>
      )}

      {formOpen && (
        <form
          className="account-api-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void saveConfig();
          }}
        >
          <h3>{editingId ? "编辑配置" : "新增配置"}</h3>
          <div className="account-api-providers" role="group" aria-label="供应商">
            {MODEL_PROVIDERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`account-api-chip ${provider === item.id ? "is-active" : ""}`}
                aria-pressed={provider === item.id}
                onClick={() => chooseProvider(item.id)}
              >
                <strong>{item.label}</strong>
                <span>{item.vendor}</span>
              </button>
            ))}
          </div>
          <label>
            配置名称
            <input
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
                invalidateTest();
              }}
              maxLength={60}
              placeholder="例如 我的 DeepSeek"
            />
          </label>
          <label>
            接入地址 Base URL
            <input
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                invalidateTest();
              }}
              placeholder="https://api.example.com/v1"
              inputMode="url"
            />
          </label>
          <label>
            模型名
            <input
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                invalidateTest();
              }}
              placeholder={preset?.modelHint || "模型名"}
            />
          </label>
          {provider === "custom" && (
            <label>
              接口协议
              <select
                value={protocol}
                onChange={(event) => {
                  setProtocol(event.target.value as typeof protocol);
                  invalidateTest();
                }}
              >
                <option value="openai">OpenAI Chat Completions 兼容</option>
                <option value="anthropic">Anthropic Messages</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </label>
          )}
          <label>
            API Key
            <div className="account-api-key">
              <input
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  invalidateTest();
                }}
                type={showKey ? "text" : "password"}
                placeholder={editingId ? "留空则不修改已保存的密钥" : "sk-..."}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowKey((value) => !value)}
                aria-label={showKey ? "隐藏密钥" : "显示密钥"}
              >
                {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          {error && (
            <p className="account-api-error" role="alert">
              <XCircle size={16} /> {error}
            </p>
          )}
          {message && (
            <p className="account-api-success" role="status">
              <CheckCircle2 size={16} /> {message}
            </p>
          )}
          <div className="account-api-actions">
            <button
              type="button"
              className="account-api-test"
              onClick={() => void testDraft()}
              disabled={busy !== ""}
            >
              {busy === "test-draft" ? <Loader2 size={16} /> : null}
              测试
            </button>
            {loggedIn ? (
              <button
                type="submit"
                className="account-api-save"
                disabled={busy !== "" || !draftTested}
                title={draftTested ? undefined : "请先测试连接"}
              >
                {busy === "save" ? <Loader2 size={16} /> : null}
                保存
              </button>
            ) : null}
            <button
              type="button"
              className="account-api-cancel"
              onClick={() => {
                setFormOpen(false);
                invalidateTest();
              }}
              disabled={busy !== ""}
            >
              取消
            </button>
          </div>
        </form>
      )}

      {!formOpen && error && (
        <p className="account-api-error" role="alert">
          <XCircle size={16} /> {error}
        </p>
      )}
      {!formOpen && message && (
        <p className="account-api-success" role="status">
          <CheckCircle2 size={16} /> {message}
        </p>
      )}
    </>
  );
}
