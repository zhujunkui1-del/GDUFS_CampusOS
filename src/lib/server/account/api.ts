import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { withApi } from "../http";
import { ApiError } from "../errors";
import { readJson } from "../assistant/http-context";
import { primaryDatabase, type SqlDatabase } from "../assistant/database";
import { accountCookie, assertAccountOrigin } from "./security";
import { AccountService } from "./email";
import { TencentSesMailer } from "./tencent-ses";
import { measuredAccountDatabase } from "./metrics";

export const accountMethods: Record<string, readonly string[]> = {
  "/api/auth/register": ["POST"],
  "/api/auth/register/email-code": ["POST"],
  "/api/auth/login": ["POST"],
  "/api/auth/logout": ["POST"],
  "/api/auth/session": ["GET"],
  "/api/auth/password/change": ["POST"],
  "/api/auth/password/reset/request": ["POST"],
  "/api/auth/password/reset/confirm": ["POST"],
  "/api/auth/email/bind": ["POST"],
  "/api/auth/email/change": ["POST"],
  "/api/auth/email/verify": ["POST"],
  "/api/auth/email/unbind": ["POST"],
  "/api/auth/email/unbind/request": ["POST"],
  "/api/me": ["GET", "PATCH"],
};
export function createAccountApi(options: {
  store: AccountService;
  enabled: boolean;
  defer(task: Promise<unknown>): void;
}) {
  return async (request: Request) => {
    let cookie: string | undefined;
    const response = await withApi(async () => {
      const { store } = options,
        path = new URL(request.url).pathname;
      if (!accountMethods[path]?.includes(request.method))
        throw new ApiError("INVALID_ARGUMENT", "请求方法不受支持。");
      if (new URL(request.url).search)
        throw new ApiError("INVALID_ARGUMENT", "此接口不接受查询参数。");
      if (path === "/api/auth/session" && !options.enabled)
        return { available: false, user: null, mailAvailable: false };
      if (!options.enabled)
        throw new ApiError("SERVICE_UNAVAILABLE", "账号服务暂不可用。", true);
      const ip = request.headers.get("CF-Connecting-IP") || "local";
      const write = request.method !== "GET";
      if (write) assertAccountOrigin(request, store.allowedOrigins);
      const body = write ? await readJson(request, 8192) : undefined;
      if (path === "/api/auth/session") {
        const session = await store.resolve(request);
        return {
          available: true,
          user: session ? store.profile(session.row) : null,
          expiresAt: session?.expiresAt || null,
          mailAvailable: store.mailer.available,
        };
      }
      if (path === "/api/me" && request.method === "GET")
        return { user: store.profile((await store.require(request)).row) };
      if (path === "/api/auth/register") {
        const result = await store.register(body, request, ip);
        cookie = accountCookie(result.token);
        return {
          user: result.profile,
          expiresAt: result.expiresAt,
          mailAvailable: store.mailer.available,
        };
      }
      if (path === "/api/auth/register/email-code")
        return store.registrationCode(body, ip);
      if (path === "/api/auth/email/unbind/request") {
        z.object({}).strict().parse(body);
        await store.limit("email_unbind_request", ip);
        return store.requestUnbind(request);
      }
      if (path === "/api/auth/login") {
        const result = await store.login(body, request, ip);
        cookie = accountCookie(result.token);
        return {
          user: result.profile,
          expiresAt: result.expiresAt,
          mailAvailable: store.mailer.available,
        };
      }
      if (path === "/api/auth/logout") {
        z.object({}).strict().parse(body);
        const result = await store.logout(request);
        cookie = accountCookie("", 0);
        return result;
      }
      if (path === "/api/me")
        return { user: await store.rename(body, request) };
      if (path === "/api/auth/password/change") {
        const result = await store.changePassword(body, request);
        cookie = accountCookie(result.token);
        return { user: result.profile, expiresAt: result.expiresAt };
      }
      if (path === "/api/auth/email/bind" || path === "/api/auth/email/change")
        return store.requestEmail(body, request);
      if (path === "/api/auth/email/unbind") {
        await store.limit("email_unbind", ip);
        return { user: await store.unbindEmail(body, request) };
      }
      if (path === "/api/auth/email/verify") {
        await store.limit("email_verify", ip);
        return store.verifyEmail(body, request);
      }
      if (path === "/api/auth/password/reset/request")
        return store.requestReset(body, ip, options.defer);
      if (path === "/api/auth/password/reset/confirm") {
        await store.limit("reset_confirm", ip);
        return store.confirmReset(body);
      }
      throw new ApiError("NOT_FOUND", "接口不存在。");
    })(request);
    if (cookie) response.headers.append("Set-Cookie", cookie);
    response.headers.set("Vary", "Cookie");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
}
export async function accountApi(request: Request) {
  try {
    const { env, ctx } = getCloudflareContext(),
      values = env as unknown as Record<string, unknown>;
    if (!values.DB)
      return withApi(() => {
        throw new ApiError("SERVICE_UNAVAILABLE", "账号服务暂不可用。", true);
      })(request);
    const origin = String(values.ACCOUNT_ORIGIN || "");
    const measured = measuredAccountDatabase(
      primaryDatabase(values.DB as SqlDatabase),
    );
    const store = new AccountService(measured.database, {
      origin,
      allowedOrigins: String(values.ACCOUNT_ALLOWED_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      otpSecret: String(values.ACCOUNT_OTP_SECRET || ""),
      mailer: new TencentSesMailer({
        secretId: String(values.ACCOUNT_MAIL_SECRET_ID || ""),
        secretKey: String(values.ACCOUNT_MAIL_SECRET_KEY || ""),
        region: String(values.ACCOUNT_MAIL_REGION || ""),
        from: String(values.ACCOUNT_MAIL_FROM || ""),
        templateId: Number(values.ACCOUNT_MAIL_TEMPLATE_ID || 0),
        verified:
          values.ACCOUNT_MAIL_VERIFIED === "true" &&
          String(values.ACCOUNT_OTP_SECRET || "").length >= 32,
      }),
    });
    const response = await createAccountApi({
      store,
      enabled: values.USER_ACCOUNTS_ENABLED === "true" && !!origin,
      defer: (task) => ctx.waitUntil(task),
    })(request);
    console.info(
      JSON.stringify({
        event: "account.request",
        path: new URL(request.url).pathname,
        status: response.status,
        ...measured.totals,
      }),
    );
    return response;
  } catch {
    return withApi(() => {
      throw new ApiError("SERVICE_UNAVAILABLE", "账号服务暂不可用。", true);
    })(request);
  }
}
export async function cleanAccountMetadata(db: SqlDatabase, now = Date.now()) {
  await db.batch([
    db
      .prepare(
        "DELETE FROM user_auth_rate_windows WHERE key IN(SELECT key FROM user_auth_rate_windows WHERE expires_at_ms<? LIMIT 200)",
      )
      .bind(now),
    db
      .prepare(
        "DELETE FROM user_auth_tokens WHERE token_hash IN(SELECT token_hash FROM user_auth_tokens WHERE expires_at_ms<? LIMIT 200)",
      )
      .bind(now - 86400000),
    db
      .prepare(
        "DELETE FROM login_sessions WHERE session_hash IN(SELECT session_hash FROM login_sessions WHERE expires_at<? LIMIT 200)",
      )
      .bind(new Date(now).toISOString()),
    db
      .prepare(
        "DELETE FROM user_auth_events WHERE id IN(SELECT id FROM user_auth_events WHERE created_at_ms<? LIMIT 200)",
      )
      .bind(now - 90 * 86400000),
  ]);
}
