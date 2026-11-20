"use client";
import { useState } from "react";
import type { ConsoleActor } from "@/domain/console/contracts";
import { useConsoleV2Data } from "@/features/console/v2-workspace";

type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type TierId = "deepseek" | "stepfun" | "gdufs";
type Tier = {
  id: TierId;
  configured: boolean;
  enabled: boolean;
  ready: boolean;
  code?: string;
  model?: string;
  testedAt?: string;
  policyVersion?: string;
};
type Health = {
  hours: number;
  since: string;
  providers: {
    provider: string;
    resolved: number;
    fallbacksIn: number;
    fallbacksOut: number;
    failures: number;
    lastAt: string | null;
  }[];
  failures: {
    provider: string;
    code: string;
    count: number;
    lastAt: string | null;
  }[];
};
type PlatformModels = {
  version: number;
  enabled: boolean;
  order: TierId[];
  tiers: Tier[];
  fallback: boolean;
  updatedAt: string | number | null;
  canManage: boolean;
  health: Health;
};
const tierNames: Record<TierId, string> = {
  deepseek: "DeepSeek",
  stepfun: "StepFun",
  gdufs: "校园网关",
};
const tierNotes: Record<TierId, string> = {
  deepseek: "平台主力模型，凭据保存在 Worker Secret。",
  stepfun: "备用链路，仅在主力出现额度、限流、上游不可用或超时时接管。",
  gdufs: "内网网关，只有校内网络可达，默认不加入链路。",
};
const codeNames: Record<string, string> = {
  MODEL_TEST_REQUIRED: "能力回执失效，需要重新验证",
  MODEL_SELECTION_REQUIRED: "未配置模型",
  MODEL_DISABLED: "平台模型已停用",
  MODEL_QUOTA_EXHAUSTED: "额度耗尽",
  MODEL_RATE_LIMITED: "触发限流",
  MODEL_SERVICE_UNAVAILABLE: "上游不可用",
  MODEL_NETWORK_ERROR: "网络异常",
  MODEL_TIMEOUT: "请求超时",
  MODEL_KEY_INVALID: "凭据无效",
  MODEL_NOT_FOUND_OR_FORBIDDEN: "模型不存在或无权限",
};
const time = (value: string | number | null | undefined) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "—";
const ranges = [24, 72, 168];
type Draft = {
  enabled: boolean;
  order: TierId[];
  tiers: Record<TierId, boolean>;
};
// Only enabled tiers form the chain order; disabled ones keep their flag so the
// panel can offer to switch them back on.
const draftFrom = (data: PlatformModels): Draft => {
  const tiers = { deepseek: false, stepfun: false, gdufs: false } as Record<
    TierId,
    boolean
  >;
  for (const tier of data.tiers) tiers[tier.id] = tier.enabled;
  const order = data.order.filter((id) => tiers[id]);
  for (const tier of data.tiers)
    if (tiers[tier.id] && !order.includes(tier.id)) order.push(tier.id);
  return { enabled: data.enabled, order, tiers };
};

// The console owner switches the platform model chain, picks which tiers may
// serve and in what order; the health card shows what actually answered.
export function PlatformModelsPanel(props: {
  request: Client;
  actor: ConsoleActor;
}) {
  const [range, setRange] = useState(24);
  const { data, error, reload } = useConsoleV2Data<PlatformModels>(
    props.request,
    "v2/platform-models?hours=" + range,
  );
  const [pending, setPending] = useState<Draft | null>(null);
  // The draft IS the fetched policy until the operator changes something, so no
  // effect needs to copy server data into state.
  const draft = pending ?? (data ? draftFrom(data) : null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const save = async (next: Draft | null = null) => {
    const target = next ?? draft;
    if (!data || !target) return;
    setBusy(true);
    setFailed(false);
    try {
      await props.request("v2/platform-models", "POST", {
        commandId: crypto.randomUUID(),
        expectedVersion: data.version,
        enabled: target.enabled,
        order: target.order,
        tiers: target.tiers,
      });
      setMessage(
        next
          ? next.enabled
            ? "平台模型已启用。"
            : "平台模型已停用。"
          : "平台模型设置已保存。",
      );
      setPending(null);
      await reload();
    } catch (cause) {
      setFailed(true);
      setMessage(
        cause instanceof Error ? cause.message : "保存失败，请刷新后重试。",
      );
    } finally {
      setBusy(false);
    }
  };
  const move = (id: TierId, direction: -1 | 1) => {
    if (!draft) return;
    const order = [...draft.order];
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setPending({ ...draft, order });
  };
  const toggleTier = (id: TierId) => {
    if (!draft) return;
    const tiers = { ...draft.tiers, [id]: !draft.tiers[id] };
    const order = tiers[id]
      ? [...draft.order, ...(draft.order.includes(id) ? [] : [id])]
      : draft.order.filter((entry) => entry !== id);
    setPending({ ...draft, tiers, order });
  };
  if (error && !data)
    return (
      <section className="console-card">
        <p className="console-feedback" role="status">
          {error}
        </p>
      </section>
    );
  const readOnly = !data?.canManage;
  return (
    <>
      <div className="console-heading">
        <h1>平台模型</h1>
      </div>
      {message ? (
        <p
          className="console-feedback"
          role="status"
          data-error={failed ? "true" : undefined}
        >
          {message}
        </p>
      ) : null}
      {data?.fallback ? (
        <p className="console-feedback" role="status">
          当前保存的模型设置无法解析，正在使用 Worker 变量决定的链路。
        </p>
      ) : null}
      <section className="console-card">
        <h2>总闸</h2>
        <p>
          {draft?.enabled
            ? "平台模型已启用，助理按下方顺序选择模型。点按钮立即生效。"
            : "平台模型已停用，助理会直接提示模型不可用。点按钮立即生效。"}
        </p>
        <div className="console-actions">
          <button
            type="button"
            className="secondary-button"
            aria-pressed={draft?.enabled === true}
            disabled={busy || readOnly || !draft}
            onClick={() =>
              draft && void save({ ...draft, enabled: !draft.enabled })
            }
          >
            {draft?.enabled ? "停用平台模型" : "启用平台模型"}
          </button>
        </div>
      </section>
      <section className="console-card">
        <h2>模型层级与顺序</h2>
        <p>顺序即降级顺序：第一层失败时按顺序交给下一层，凭据不在这里填写。</p>
        <ol className="console-model-tiers">
          {(draft?.order || []).map((id, index) => {
            const tier = data?.tiers.find((entry) => entry.id === id);
            return (
              <li key={id} className="console-model-tier">
                <div className="console-model-tier-main">
                  <strong>
                    {index + 1}. {tierNames[id]}
                  </strong>
                  <span className="console-badge">
                    {tier?.configured ? "已配置凭据" : "未配置凭据"}
                  </span>
                  <span className="console-badge">
                    {tier?.ready
                      ? "回执有效"
                      : tier?.code
                        ? codeNames[tier.code] || tier.code
                        : "未验证"}
                  </span>
                  {tier?.model ? (
                    <span className="console-model-tier-model">
                      {tier.model}
                    </span>
                  ) : null}
                </div>
                <p>{tierNotes[id]}</p>
                <div className="console-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || readOnly || index === 0}
                    onClick={() => move(id, -1)}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      busy ||
                      readOnly ||
                      index === (draft?.order.length ?? 1) - 1
                    }
                    onClick={() => move(id, 1)}
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || readOnly}
                    onClick={() => toggleTier(id)}
                  >
                    停用此层
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        {draft && Object.entries(draft.tiers).some(([, on]) => !on) ? (
          <div className="console-model-paused">
            <p>已停用的层级：</p>
            <div className="console-actions">
              {data?.tiers
                .filter((tier) => !draft.tiers[tier.id])
                .map((tier) => (
                  <button
                    key={tier.id}
                    type="button"
                    className="secondary-button"
                    disabled={busy || readOnly}
                    onClick={() => toggleTier(tier.id)}
                  >
                    启用 {tierNames[tier.id]}
                  </button>
                ))}
            </div>
          </div>
        ) : null}
        <div className="console-actions">
          <button
            type="button"
            className="primary-button"
            disabled={busy || readOnly || !draft}
            onClick={() => void save()}
          >
            {busy ? "保存中…" : "保存顺序与层级"}
          </button>
          <span className="console-model-version">
            版本 {data?.version ?? "—"} · 更新于 {time(data?.updatedAt)}
          </span>
        </div>
        {pending ? (
          <p className="console-feedback" role="status">
            顺序或层级的改动还没保存，点「保存顺序与层级」后生效。
          </p>
        ) : null}
        {readOnly ? (
          <p className="console-feedback" role="status">
            只有管理员或负责人指定的账号可以调整平台模型。
          </p>
        ) : null}
      </section>
      <section className="console-card">
        <h2>模型健康</h2>
        <p>
          统计窗口内真正回答过请求的模型，以及链路切换与失败原因；来源是运行时的路由记录。
        </p>
        <div className="console-actions">
          {ranges.map((value) => (
            <button
              key={value}
              type="button"
              className="secondary-button"
              aria-pressed={range === value}
              disabled={busy}
              onClick={() => setRange(value)}
            >
              近 {value} 小时
            </button>
          ))}
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void reload()}
          >
            刷新
          </button>
        </div>
        {data?.health.providers.length ? (
          <table className="console-model-health">
            <thead>
              <tr>
                <th>模型</th>
                <th>成功回答</th>
                <th>接管次数</th>
                <th>让出次数</th>
                <th>失败</th>
                <th>最近</th>
              </tr>
            </thead>
            <tbody>
              {data.health.providers.map((row) => (
                <tr key={row.provider}>
                  <td>{tierNames[row.provider as TierId] || row.provider}</td>
                  <td>{row.resolved}</td>
                  <td>{row.fallbacksIn}</td>
                  <td>{row.fallbacksOut}</td>
                  <td>{row.failures}</td>
                  <td>{time(row.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="console-feedback" role="status">
            窗口内还没有模型调用记录。
          </p>
        )}
        {data?.health.failures.length ? (
          <ul className="console-model-failures">
            {data.health.failures.map((row) => (
              <li key={row.provider + row.code}>
                {tierNames[row.provider as TierId] || row.provider} ·{" "}
                {codeNames[row.code] || row.code} · {row.count} 次 ·{" "}
                {time(row.lastAt)}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}
