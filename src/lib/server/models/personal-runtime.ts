import type { SqlDatabase } from "../assistant/database";
import type { ModelClient, ModelSnapshot } from "@/domain/models/contracts";
import { ApiError } from "../errors";
import { ModelConfigStore } from "./model-config-store";
import { PersonalModelClient } from "./personal-client";

export async function personalModelRuntime(
  db: SqlDatabase,
  owner: string,
  secret: string,
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
  const client = new PersonalModelClient(active.config);
  return { client, snapshot: client.snapshot };
}
