import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  defaultPlatformModelPolicy,
  type ModelTierId,
  PlatformModelPolicySchema,
  type PlatformModelPolicy,
} from "@/domain/console/platform-models";
import type { ModelSnapshot } from "@/domain/models/contracts";
import type { SqlDatabase } from "../assistant/database";
import { ApiError, type ErrorCode } from "../errors";
import { ModelRouter } from "./router";
import { modelPriorityOrder, PriorityModelRouter } from "./priority";

export type ModelTierRouters = {
  deepseek: ModelRouter;
  stepfun: ModelRouter | null;
  gdufs: ModelRouter | null;
};

type Bindings = Record<string, unknown>;

function bindings(): {
  bindings: Bindings;
  value: (name: string) => string | undefined;
} {
  let env: Bindings = {};
  try {
    env = getCloudflareContext().env as unknown as Bindings;
  } catch {
    /* Node dev */
  }
  return {
    bindings: env,
    value: (name: string) =>
      typeof env[name] === "string" ? (env[name] as string) : process.env[name],
  };
}

// Every tier shares the same output policy; credentials stay in Worker secrets.
export function modelTierRouters(
  options: { providerManagedOutput?: boolean } = {},
): ModelTierRouters {
  const { value } = bindings();
  const maxOutputTokens =
    value("MODEL_MAX_OUTPUT_TOKENS") === "2048" ? 2048 : 1024;
  const providerManagedOutput = options.providerManagedOutput === true;
  const deepseek = new ModelRouter({
    providerManagedOutput,
    maxOutputTokens,
    apiKey: value("MODEL_API_KEY"),
    model: value("MODEL_NAME"),
    baseUrl: value("MODEL_BASE_URL"),
    capabilityReceipt: value("MODEL_CAPABILITIES_JSON"),
  });
  const step = value("PRIMARY_MODEL_API_KEY")
    ? new ModelRouter({
        provider: "stepfun",
        providerManagedOutput,
        maxOutputTokens,
        apiKey: value("PRIMARY_MODEL_API_KEY"),
        model: value("PRIMARY_MODEL_NAME"),
        baseUrl: value("PRIMARY_MODEL_BASE_URL"),
        capabilityReceipt: value("PRIMARY_MODEL_CAPABILITIES_JSON"),
      })
    : null;
  // The campus gateway is reachable only from the campus network, so it is
  // built whenever a key exists but is not part of the default chain.
  const gdufs = value("GDUFS_MODEL_API_KEY")
    ? new ModelRouter({
        provider: "gdufs",
        providerManagedOutput,
        maxOutputTokens,
        apiKey: value("GDUFS_MODEL_API_KEY"),
        model: value("GDUFS_MODEL_NAME"),
        baseUrl: value("GDUFS_MODEL_BASE_URL"),
        capabilityReceipt: value("GDUFS_MODEL_CAPABILITIES_JSON"),
      })
    : null;
  return { deepseek, stepfun: step, gdufs };
}

export type PlatformModelState = {
  enabled: boolean;
  policy: PlatformModelPolicy;
  version: number | null;
  updatedAt: string | null;
  // True when the row could not be read and the Worker variables decided the
  // chain; the console reports this instead of pretending the settings applied.
  fallback: boolean;
};

export function envPlatformModelState(): PlatformModelState {
  const { value } = bindings();
  const order = modelPriorityOrder(value("MODEL_PRIORITY"));
  return {
    enabled: true,
    policy: {
      order,
      tiers: {
        deepseek: true,
        stepfun: true,
        gdufs: order[0] === "gdufs",
      },
    },
    version: null,
    updatedAt: null,
    fallback: true,
  };
}

// One small read per request. There is no KV binding, and a chat request
// already touches D1: a failed read falls back to the Worker variables instead
// of taking the assistant offline.
export async function platformModelState(
  db: SqlDatabase | undefined,
): Promise<PlatformModelState> {
  if (!db) return envPlatformModelState();
  try {
    const row = await db
      .prepare(
        "SELECT platform_model_enabled,platform_models_json,version,updated_at FROM console_engine_settings WHERE id='console-v2-settings'",
      )
      .first<{
        platform_model_enabled: number;
        platform_models_json: string;
        version: number;
        updated_at: string | null;
      }>();
    if (!row) return envPlatformModelState();
    const parsed = PlatformModelPolicySchema.safeParse(
      JSON.parse(row.platform_models_json || "{}"),
    );
    const policy = parsed.success ? parsed.data : defaultPlatformModelPolicy;
    return {
      enabled: row.platform_model_enabled === 1,
      policy,
      version: row.version,
      updatedAt: row.updated_at,
      fallback: !parsed.success,
    };
  } catch {
    return envPlatformModelState();
  }
}

export type ModelEvent = {
  event: "fallback" | "failed";
  provider: string;
  model?: string;
  from?: string;
  code?: string;
};

export type ModelRuntimeOptions = {
  providerManagedOutput?: boolean;
  db?: SqlDatabase;
  onEvent?: (event: ModelEvent) => void | Promise<void>;
};

export function buildPlatformRuntime(
  state: PlatformModelState,
  options: ModelRuntimeOptions = {},
) {
  if (!state.enabled)
    throw new ApiError("MODEL_DISABLED", "平台模型已由管理员停用。");
  const routers = modelTierRouters(options);
  const byId: Record<ModelTierId, ModelRouter | null> = {
    deepseek: routers.deepseek,
    stepfun: routers.stepfun,
    gdufs: routers.gdufs,
  };
  const tiers: ModelRouter[] = [];
  for (const tier of state.policy.order) {
    const router = byId[tier];
    if (router && state.policy.tiers[tier]) tiers.push(router);
  }
  if (!tiers.length)
    throw new ApiError("MODEL_SELECTION_REQUIRED", "平台模型没有启用的层级。");
  return tiers.length === 1
    ? tiers[0]
    : new PriorityModelRouter(tiers[0], tiers.slice(1), options.onEvent);
}

// Status is read by the assistant session endpoint and both health routes; a
// disabled or mis-configured chain reports a code instead of throwing.
export async function platformModelStatus(
  db?: SqlDatabase,
): Promise<
  { ready: true; model: ModelSnapshot } | { ready: false; code: ErrorCode }
> {
  try {
    return await buildPlatformRuntime(await platformModelState(db)).status();
  } catch (error) {
    return {
      ready: false,
      code:
        error instanceof ApiError ? error.code : "MODEL_SERVICE_UNAVAILABLE",
    };
  }
}
export async function platformModelRuntime(options: ModelRuntimeOptions = {}) {
  return buildPlatformRuntime(await platformModelState(options.db), options);
}
