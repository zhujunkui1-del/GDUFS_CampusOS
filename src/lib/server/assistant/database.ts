import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ApiError } from "../errors";

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{
    results: T[];
    meta?: { rows_read?: number; rows_written?: number; size_after?: number };
  }>;
  run(): Promise<{
    meta: {
      changes: number;
      rows_read?: number;
      rows_written?: number;
      size_after?: number;
    };
  }>;
}
export interface SqlDatabase {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
  withSession?(constraint: "first-primary"): SqlDatabase;
}
export function primaryDatabase(binding: SqlDatabase): SqlDatabase {
  return {
    prepare: (sql) =>
      (binding.withSession?.("first-primary") || binding).prepare(sql),
    batch: (statements) =>
      (binding.withSession?.("first-primary") || binding).batch(statements),
  };
}
export function assistantBindings() {
  let env: Record<string, unknown>;
  try {
    env = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    throw new ApiError("SERVICE_UNAVAILABLE", "请使用已配置数据库的服务预览。");
  }
  if (!env.DB)
    throw new ApiError("SERVICE_UNAVAILABLE", "AI 会话服务暂不可用。");
  const signingSecret =
    typeof env.AGENT_SIGNING_SECRET === "string"
      ? env.AGENT_SIGNING_SECRET
      : process.env.AGENT_SIGNING_SECRET;
  if (!signingSecret || signingSecret.length < 32)
    throw new ApiError("SERVICE_UNAVAILABLE", "AI 会话服务尚未配置。");
  return {
    db: primaryDatabase(env.DB as SqlDatabase),
    signingSecret,
    gatewayProxySecret:
      typeof env.GATEWAY_PROXY_SECRET === "string"
        ? env.GATEWAY_PROXY_SECRET
        : process.env.GATEWAY_PROXY_SECRET || "",
    credentialSecret:
      typeof env.MODEL_CREDENTIALS_KEY === "string"
        ? env.MODEL_CREDENTIALS_KEY
        : typeof env.ACCOUNT_OTP_SECRET === "string"
          ? env.ACCOUNT_OTP_SECRET
          : process.env.MODEL_CREDENTIALS_KEY ||
            process.env.ACCOUNT_OTP_SECRET ||
            "",
    environment: String(env.APP_ENV || "local"),
    difyAppApiKey:
      typeof env.DIFY_APP_API_KEY === "string" ? env.DIFY_APP_API_KEY : "",
    difyChatEnabled: env.DIFY_CHAT_ENABLED === "true",
    modelRequestOutputLimit:
      env.MODEL_MAX_OUTPUT_TOKENS === "2048" ? 2048 : 1024,
    openValidation:
      env.APP_ENV === "preview" && env.AGENT_VALIDATION_UNLIMITED === "true",
    externalSearch: {
      transport:
        env.EXTERNAL_SEARCH_TRANSPORT === "cloud"
          ? ("cloud" as const)
          : env.EXTERNAL_SEARCH_TRANSPORT === "d1-relay"
            ? ("d1-relay" as const)
            : undefined,
      cloudBinding: env.CLOUD_SEARCH as
        import("../external-search/cloud").CloudSearchBinding | undefined,
      cloudToken:
        typeof env.CLOUD_SEARCH_TOKEN === "string"
          ? env.CLOUD_SEARCH_TOKEN
          : undefined,
      exaApiKey:
        typeof env.EXA_API_KEY === "string" ? env.EXA_API_KEY : undefined,
      gatewayUrl:
        typeof env.EXTERNAL_SEARCH_GATEWAY_URL === "string"
          ? env.EXTERNAL_SEARCH_GATEWAY_URL
          : undefined,
      gatewayToken:
        typeof env.EXTERNAL_SEARCH_GATEWAY_TOKEN === "string"
          ? env.EXTERNAL_SEARCH_GATEWAY_TOKEN
          : undefined,
      webEnabled: env.EXTERNAL_WEB_SEARCH_ENABLED !== "false",
    },
  };
}
