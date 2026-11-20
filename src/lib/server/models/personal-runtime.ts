import type { SqlDatabase } from "../assistant/database";
import type { ModelClient, ModelSnapshot } from "@/domain/models/contracts";
import { ApiError, type ErrorCode } from "../errors";
import { ModelConfigStore } from "./model-config-store";
import { PersonalProviderRegistry } from "./personal-client";

export async function personalModelRuntime(
  db: SqlDatabase,
  owner: string,
  secret: string,
  registry = new PersonalProviderRegistry(),
): Promise<{ client: ModelClient; snapshot: ModelSnapshot } | null> {
  if (!owner.startsWith("u:")) return null;
  const userId = owner.slice(2);
  const store = new ModelConfigStore(db, secret);
  if (secret.length < 32) {
    const preference = await store.preference(userId);
    if (preference.mode === "personal")
      throw new ApiError(
        "MODEL_NOT_CONNECTED",
        "当前个人模型的加密密钥不可用，请重新保存配置或切回平台模型。",
      );
    return null;
  }
  const active = await store.active(userId);
  if (active.mode === "platform") return null;
  const client = registry.create(active.config);
  return { client, snapshot: client.snapshot };
}

/**
 * Readiness of the account's own model, without throwing. Guests and accounts
 * on the platform preference return null so the caller falls back to the
 * platform chain; an account that picked a personal model keeps working even
 * when the operator switched the platform chain off.
 */
export async function personalModelStatus(
  db: SqlDatabase,
  owner: string,
  secret: string,
  registry = new PersonalProviderRegistry(),
): Promise<
  | { ready: true; model: ModelSnapshot }
  | { ready: false; code: ErrorCode }
  | null
> {
  if (!owner.startsWith("u:")) return null;
  const userId = owner.slice(2);
  const store = new ModelConfigStore(db, secret);
  try {
    const preference = await store.preference(userId);
    if (preference.mode === "platform") return null;
    if (secret.length < 32)
      return { ready: false, code: "MODEL_NOT_CONNECTED" };
    const active = await store.active(userId);
    if (active.mode === "platform") return null;
    return { ready: true, model: registry.create(active.config).snapshot };
  } catch (error) {
    return {
      ready: false,
      code:
        error instanceof ApiError ? error.code : "MODEL_SERVICE_UNAVAILABLE",
    };
  }
}
