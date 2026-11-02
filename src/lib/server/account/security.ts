import { ApiError } from "../errors";
import type { SqlDatabase } from "../assistant/database";
import { tokenHash } from "../assistant/crypto";
export const ACCOUNT_COOKIE = "campusos_session";
export const SESSION_MS = 30 * 86400000;
export function cookieValue(request: Request, name = ACCOUNT_COOKIE) {
  const values = (request.headers.get("Cookie") || "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + "="));
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
export function accountCookie(token: string, age = SESSION_MS / 1000) {
  return `${ACCOUNT_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
}
export function assertAccountOrigin(
  request: Request,
  expected: string | readonly string[],
) {
  const url = new URL(request.url);
  const allowed = typeof expected === "string" ? [expected] : expected;
  if (
    !allowed.includes(url.origin) ||
    !allowed.includes(request.headers.get("Origin") || "") ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    throw new ApiError("FORBIDDEN", "请求来源不受支持。");
  if (
    request.method !== "DELETE" &&
    !request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new ApiError("INVALID_ARGUMENT", "请使用JSON提交请求。");
}
export async function authLimit(
  db: SqlDatabase,
  scope: string,
  identifier: string,
  limit: number,
  periodMs: number,
  now = Date.now(),
) {
  const key = scope + ":" + (await tokenHash(identifier));
  const r = await db
    .prepare(
      `INSERT INTO user_auth_rate_windows(key,hits,expires_at_ms) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN expires_at_ms<=? THEN 1 ELSE hits+1 END,expires_at_ms=CASE WHEN expires_at_ms<=? THEN excluded.expires_at_ms ELSE expires_at_ms END WHERE expires_at_ms<=? OR hits<?`,
    )
    .bind(key, now + periodMs, now, now, now, limit)
    .run();
  if (!r.meta.changes)
    throw new ApiError("RATE_LIMITED", "操作过于频繁，请稍后再试。", true);
}
