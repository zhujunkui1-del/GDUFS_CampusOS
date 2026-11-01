import type { SqlDatabase } from "../assistant/database";
import { ApiError } from "../errors";
import {
  assertSafeModelBaseUrl,
  decryptModelSecret,
  encryptModelSecret,
  maskKey,
} from "./credentials";
import { testPersonalConnection } from "./personal-client";
import { providerById, type ModelProtocol } from "@/domain/models/providers";

export type ModelConfigStatus = "untested" | "connected" | "failed" | "disabled";

export type PublicModelConfig = {
  id: string;
  displayName: string;
  provider: string;
  protocol: ModelProtocol;
  baseUrl: string;
  model: string;
  keyHint: string;
  status: ModelConfigStatus;
  lastError: string | null;
  testedAt: string | null;
  updatedAt: string;
  version: number;
  active: boolean;
};

type Row = {
  id: string;
  user_id: string;
  display_name: string;
  provider: string;
  protocol: ModelProtocol;
  base_url: string;
  model: string;
  secret_cipher: string;
  key_hint: string;
  status: ModelConfigStatus;
  last_error: string | null;
  tested_at_ms: number | null;
  version: number;
  updated_at_ms: number;
};

export type ModelConfigInput = {
  displayName: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  protocol?: string;
};

export type ActiveModelConfig = {
  id: string;
  displayName: string;
  provider: string;
  protocol: ModelProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  version: number;
};

const SELECT =
  "SELECT id,user_id,display_name,provider,protocol,base_url,model,secret_cipher,key_hint,status,last_error,tested_at_ms,version,updated_at_ms FROM user_model_configs";

function protocolFor(provider: string, requested?: string): ModelProtocol {
  const preset = providerById(provider);
  if (preset) return preset.protocol;
  if (requested === "anthropic" || requested === "gemini") return requested;
  return "openai";
}

function publicConfig(row: Row, activeId: string | null): PublicModelConfig {
  return {
    id: row.id,
    displayName: row.display_name,
    provider: row.provider,
    protocol: row.protocol,
    baseUrl: row.base_url,
    model: row.model,
    keyHint: row.key_hint,
    status: row.status,
    lastError: row.last_error,
    testedAt: row.tested_at_ms
      ? new Date(row.tested_at_ms).toISOString()
      : null,
    updatedAt: new Date(row.updated_at_ms).toISOString(),
    version: row.version,
    active: row.id === activeId,
  };
}

function validate(input: ModelConfigInput) {
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 60)
    throw new ApiError("INVALID_ARGUMENT", "请填写配置名称（不超过 60 字）。");
  const baseUrl = assertSafeModelBaseUrl(input.baseUrl);
  const model = input.model.trim();
  if (!model || model.length > 120)
    throw new ApiError("INVALID_ARGUMENT", "请填写模型名。");
  const apiKey = input.apiKey.trim();
  if (apiKey.length > 4096)
    throw new ApiError("INVALID_ARGUMENT", "API Key 过长。");
  return { displayName, baseUrl, model, apiKey };
}

export class ModelConfigStore {
  constructor(
    readonly db: SqlDatabase,
    readonly secret: string,
    readonly now = () => Date.now(),
  ) {}

  async preference(userId: string): Promise<{
    mode: "platform" | "personal";
    activeConfigId: string | null;
  }> {
    const row = await this.db
      .prepare(
        "SELECT mode,active_config_id FROM user_model_preferences WHERE user_id=?",
      )
      .bind(userId)
      .first<{ mode: "platform" | "personal"; active_config_id: string | null }>();
    return {
      mode: row?.mode || "platform",
      activeConfigId: row?.active_config_id || null,
    };
  }

  async list(userId: string) {
    const pref = await this.preference(userId);
    const rows = await this.db
      .prepare(`${SELECT} WHERE user_id=? ORDER BY updated_at_ms DESC`)
      .bind(userId)
      .all<Row>();
    return rows.results.map((row) => publicConfig(row, pref.activeConfigId));
  }

  async create(userId: string, input: ModelConfigInput) {
    const value = validate(input);
    if (!value.apiKey)
      throw new ApiError("INVALID_ARGUMENT", "请填写 API Key。");
    const id = crypto.randomUUID();
    const now = this.now();
    const cipher = await encryptModelSecret(
      this.secret,
      value.apiKey,
      this.aad(userId, id),
    );
    await this.db
      .prepare(
        `INSERT INTO user_model_configs(id,user_id,display_name,provider,protocol,base_url,model,secret_cipher,key_hint,status,last_error,tested_at_ms,version,created_at_ms,updated_at_ms)
         VALUES(?,?,?,?,?,?,?,?,?,'untested',NULL,NULL,1,?,?)`,
      )
      .bind(
        id,
        userId,
        value.displayName,
        input.provider,
        protocolFor(input.provider, input.protocol),
        value.baseUrl,
        value.model,
        cipher,
        maskKey(value.apiKey),
        now,
        now,
      )
      .run();
    return (await this.findPublic(userId, id))!;
  }

  async update(userId: string, id: string, input: ModelConfigInput) {
    const current = await this.ownedRow(userId, id);
    const value = validate(input);
    const cipher = value.apiKey
      ? await encryptModelSecret(this.secret, value.apiKey, this.aad(userId, id))
      : current.secret_cipher;
    const keyHint = value.apiKey ? maskKey(value.apiKey) : current.key_hint;
    await this.db
      .prepare(
        `UPDATE user_model_configs SET display_name=?,provider=?,protocol=?,base_url=?,model=?,secret_cipher=?,key_hint=?,status='untested',last_error=NULL,tested_at_ms=NULL,version=version+1,updated_at_ms=? WHERE id=? AND user_id=?`,
      )
      .bind(
        value.displayName,
        input.provider,
        protocolFor(input.provider, input.protocol),
        value.baseUrl,
        value.model,
        cipher,
        keyHint,
        this.now(),
        id,
        userId,
      )
      .run();
    return (await this.findPublic(userId, id))!;
  }

  async remove(userId: string, id: string) {
    await this.ownedRow(userId, id);
    await this.db
      .prepare("DELETE FROM user_model_configs WHERE id=? AND user_id=?")
      .bind(id, userId)
      .run();
  }

  async test(userId: string, id: string) {
    const row = await this.ownedRow(userId, id);
    const apiKey = await decryptModelSecret(
      this.secret,
      row.secret_cipher,
      this.aad(userId, id),
    );
    try {
      const result = await testPersonalConnection({
        provider: row.provider,
        baseUrl: row.base_url,
        model: row.model,
        apiKey,
      });
      await this.setStatus(userId, id, "connected", null);
      return { ok: true as const, latencyMs: result.latencyMs };
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "连接测试失败。";
      await this.setStatus(userId, id, "failed", message);
      if (error instanceof ApiError) throw error;
      throw new ApiError("MODEL_SERVICE_UNAVAILABLE", message, true);
    }
  }

  async setStatus(
    userId: string,
    id: string,
    status: Exclude<ModelConfigStatus, "disabled">,
    error: string | null,
  ) {
    await this.db
      .prepare(
        "UPDATE user_model_configs SET status=?,last_error=?,tested_at_ms=?,updated_at_ms=? WHERE id=? AND user_id=?",
      )
      .bind(
        status,
        error,
        status === "connected" ? this.now() : null,
        this.now(),
        id,
        userId,
      )
      .run();
  }

  async disable(userId: string, id: string) {
    await this.ownedRow(userId, id);
    await this.db
      .prepare(
        "UPDATE user_model_configs SET status='disabled',updated_at_ms=? WHERE id=? AND user_id=?",
      )
      .bind(this.now(), id, userId)
      .run();
  }

  async setPreference(
    userId: string,
    mode: "platform" | "personal",
    configId?: string | null,
  ) {
    if (mode === "platform") {
      await this.writePreference(userId, "platform", null);
      return { mode, activeConfigId: null };
    }
    if (!configId)
      throw new ApiError("INVALID_ARGUMENT", "请选择要启用的模型配置。");
    const row = await this.ownedRow(userId, configId);
    if (row.status !== "connected")
      throw new ApiError(
        "MODEL_NOT_VERIFIED",
        "该配置尚未通过连接测试，不能启用。",
      );
    await this.writePreference(userId, "personal", configId);
    return { mode, activeConfigId: configId };
  }

  async active(userId: string): Promise<
    | { mode: "platform"; config: null }
    | { mode: "personal"; config: ActiveModelConfig }
  > {
    const pref = await this.preference(userId);
    if (pref.mode === "platform")
      return { mode: "platform", config: null };
    if (!pref.activeConfigId)
      throw new ApiError(
        "MODEL_NOT_CONNECTED",
        "当前没有选中的个人模型，请在 API 设置中选择一项，或切换回平台模型。",
      );
    const row = await this.db
      .prepare(`${SELECT} WHERE id=? AND user_id=?`)
      .bind(pref.activeConfigId, userId)
      .first<Row>();
    if (!row || row.status !== "connected")
      throw new ApiError(
        "MODEL_NOT_CONNECTED",
        "当前个人模型未通过连接测试或已失效，请重新测试，或切换回平台模型。",
      );
    return {
      mode: "personal",
      config: {
        id: row.id,
        displayName: row.display_name,
        provider: row.provider,
        protocol: row.protocol,
        baseUrl: row.base_url,
        model: row.model,
        apiKey: await decryptModelSecret(
          this.secret,
          row.secret_cipher,
          this.aad(userId, row.id),
        ),
        version: row.version,
      },
    };
  }

  private aad(userId: string, configId: string) {
    return `${userId}:${configId}`;
  }

  private async findPublic(userId: string, id: string) {
    const pref = await this.preference(userId);
    const row = await this.db
      .prepare(`${SELECT} WHERE id=? AND user_id=?`)
      .bind(id, userId)
      .first<Row>();
    return row ? publicConfig(row, pref.activeConfigId) : null;
  }

  private async ownedRow(userId: string, id: string) {
    const row = await this.db
      .prepare(`${SELECT} WHERE id=? AND user_id=?`)
      .bind(id, userId)
      .first<Row>();
    if (!row) throw new ApiError("NOT_FOUND", "模型配置不存在。");
    return row;
  }

  private async writePreference(
    userId: string,
    mode: "platform" | "personal",
    configId: string | null,
  ) {
    await this.db
      .prepare(
        `INSERT INTO user_model_preferences(user_id,mode,active_config_id,updated_at_ms)
         VALUES(?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,active_config_id=excluded.active_config_id,updated_at_ms=excluded.updated_at_ms`,
      )
      .bind(userId, mode, configId, this.now())
      .run();
  }
}
