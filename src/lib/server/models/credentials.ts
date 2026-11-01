import type { SqlDatabase } from "../assistant/database";
import { ApiError } from "../errors";

export type StoredModelConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type PublicModelConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  keyHint: string;
  status: "untested" | "connected" | "failed";
  lastError: string | null;
  testedAt: string | null;
  updatedAt: string;
};

type Row = {
  provider: string;
  base_url: string;
  model: string;
  secret_cipher: string;
  key_hint: string;
  status: PublicModelConfig["status"];
  last_error: string | null;
  tested_at_ms: number | null;
  updated_at_ms: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64(bytes: Uint8Array) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
function bytes(value: string) {
  const text = atob(value);
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
async function encryptionKey(secret: string) {
  if (secret.length < 32)
    throw new ApiError(
      "SERVICE_UNAVAILABLE",
      "服务端凭据加密密钥未配置，暂时无法保存个人模型。",
      true,
    );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode("campusos:user-model-credentials:v1:" + secret),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encryptModelSecret(
  secret: string,
  value: string,
  additionalData = "",
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      ...(additionalData
        ? { additionalData: encoder.encode(additionalData) }
        : {}),
    },
    await encryptionKey(secret),
    encoder.encode(value),
  );
  return `v1.${base64(iv)}.${base64(new Uint8Array(cipher))}`;
}
export async function decryptModelSecret(
  secret: string,
  value: string,
  additionalData = "",
) {
  const [version, iv, cipher] = value.split(".");
  if (version !== "v1" || !iv || !cipher)
    throw new ApiError("MODEL_KEY_INVALID", "个人模型密钥无法读取，请重新保存。");
  try {
    const clear = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes(iv),
        ...(additionalData
          ? { additionalData: encoder.encode(additionalData) }
          : {}),
      },
      await encryptionKey(secret),
      bytes(cipher),
    );
    return decoder.decode(clear);
  } catch {
    throw new ApiError("MODEL_KEY_INVALID", "个人模型密钥无法读取，请重新保存。");
  }
}

function privateIpv4(host: string) {
  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}
function privateIpv6(host: string) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "::" ||
    h === "::1" ||
    h.startsWith("fc") ||
    h.startsWith("fd") ||
    h.startsWith("fe8") ||
    h.startsWith("fe9") ||
    h.startsWith("fea") ||
    h.startsWith("feb") ||
    h.startsWith("::ffff:")
  );
}

/**
 * Accept only a public HTTPS base URL. Literal loopback, private and link-local
 * addresses are rejected before any request is made. Hostnames are additionally
 * resolved by the connection test, which blocks DNS-based private targets.
 */
export function assertSafeModelBaseUrl(raw: string) {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError("MODEL_ENDPOINT_INVALID", "接入地址格式不正确。");
  }
  if (url.protocol !== "https:")
    throw new ApiError("MODEL_ENDPOINT_INVALID", "接入地址必须使用 HTTPS。");
  if (url.username || url.password || url.search || url.hash)
    throw new ApiError(
      "MODEL_ENDPOINT_INVALID",
      "接入地址不能包含账号、查询参数或片段。",
    );
  if (url.port && url.port !== "443")
    throw new ApiError("MODEL_ENDPOINT_INVALID", "接入地址只允许 443 端口。");
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost"))
    throw new ApiError("MODEL_ENDPOINT_INVALID", "接入地址不能指向本机。");
  if (
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host === "instance-data"
  )
    throw new ApiError("MODEL_ENDPOINT_INVALID", "接入地址不在允许范围内。");
  if (host.includes(":") ? privateIpv6(host) : privateIpv4(host))
    throw new ApiError("MODEL_ENDPOINT_INVALID", "接入地址不能指向内网。");
  return value.replace(/\/+$/, "");
}

export function maskKey(key: string) {
  return key.length <= 4 ? "••••" : "••••" + key.slice(-4);
}

function publicConfig(row: Row): PublicModelConfig {
  return {
    provider: row.provider,
    baseUrl: row.base_url,
    model: row.model,
    keyHint: row.key_hint,
    status: row.status,
    lastError: row.last_error,
    testedAt: row.tested_at_ms
      ? new Date(row.tested_at_ms).toISOString()
      : null,
    updatedAt: new Date(row.updated_at_ms).toISOString(),
  };
}

export class ModelSettingsStore {
  constructor(
    readonly db: SqlDatabase,
    readonly secret: string,
    readonly now = () => Date.now(),
  ) {}
  async list(userId: string) {
    const rows = await this.db
      .prepare(
        "SELECT provider,base_url,model,secret_cipher,key_hint,status,last_error,tested_at_ms,updated_at_ms FROM user_model_settings WHERE user_id=?",
      )
      .bind(userId)
      .all<Row>();
    return rows.results.map(publicConfig);
  }
  async get(userId: string): Promise<StoredModelConfig | null> {
    const row = await this.db
      .prepare(
        "SELECT provider,base_url,model,secret_cipher FROM user_model_settings WHERE user_id=?",
      )
      .bind(userId)
      .first<Row>();
    if (!row) return null;
    return {
      provider: row.provider,
      baseUrl: row.base_url,
      model: row.model,
      apiKey: await decryptModelSecret(this.secret, row.secret_cipher),
    };
  }
  async save(
    userId: string,
    config: StoredModelConfig,
    test: { status: "connected" | "failed"; error?: string | null },
  ) {
    const baseUrl = assertSafeModelBaseUrl(config.baseUrl);
    if (!config.model.trim() || config.model.length > 120)
      throw new ApiError("INVALID_ARGUMENT", "请填写模型名。");
    if (!config.apiKey.trim() || config.apiKey.length > 4096)
      throw new ApiError("INVALID_ARGUMENT", "请填写 API Key。");
    const now = this.now();
    const cipher = await encryptModelSecret(this.secret, config.apiKey.trim());
    await this.db
      .prepare(
        `INSERT INTO user_model_settings(user_id,provider,base_url,model,secret_cipher,key_hint,status,last_error,tested_at_ms,updated_at_ms,created_at_ms)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,base_url=excluded.base_url,model=excluded.model,secret_cipher=excluded.secret_cipher,key_hint=excluded.key_hint,status=excluded.status,last_error=excluded.last_error,tested_at_ms=excluded.tested_at_ms,updated_at_ms=excluded.updated_at_ms`,
      )
      .bind(
        userId,
        config.provider,
        baseUrl,
        config.model.trim(),
        cipher,
        maskKey(config.apiKey.trim()),
        test.status,
        test.error || null,
        test.status === "connected" ? now : null,
        now,
        now,
      )
      .run();
    return (await this.list(userId))[0];
  }
  async remove(userId: string) {
    await this.db
      .prepare("DELETE FROM user_model_settings WHERE user_id=?")
      .bind(userId)
      .run();
  }
}
