import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { primaryDatabase, type SqlDatabase } from "../assistant/database";
import { randomToken, tokenHash, signData } from "../assistant/crypto";
import { sameOrigin } from "../assistant/http-context";
import { ApiError } from "../errors";
import type { ConsoleActor, ConsoleRole } from "@/domain/console/contracts";

export type ConsoleBindings = {
  db: SqlDatabase;
  environment: string;
  mode: string;
  secret: string;
  localKey: string;
  adminKey?: string;
  credentialSalt?: string;
  origin?: string;
  allowedOrigins?: string[];
  emails: string[];
  team: string;
  audience: string;
};
const emailsSchema = z.array(z.email().toLowerCase()).min(1).max(10);
const roleSchema = z.enum(["admin", "operator", "reviewer"]);
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const cookieName = "campusos_console";
export function consoleBindings(): ConsoleBindings {
  let env: Record<string, unknown>;
  try {
    env = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    throw new ApiError("SERVICE_UNAVAILABLE", "管理服务尚未配置。");
  }
  const value = (name: string) =>
    typeof env[name] === "string" ? String(env[name]) : process.env[name] || "";
  const parsed = emailsSchema.safeParse(
    value("CONSOLE_ADMIN_EMAILS")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!env.DB || !parsed.success || value("CONSOLE_SESSION_SECRET").length < 32)
    throw new ApiError("SERVICE_UNAVAILABLE", "管理员登录尚未配置。");
  return {
    db: primaryDatabase(env.DB as SqlDatabase),
    environment: String(env.APP_ENV || ""),
    mode: value("CONSOLE_AUTH_MODE"),
    secret: value("CONSOLE_SESSION_SECRET"),
    localKey: value("CONSOLE_LOCAL_ACCESS_KEY"),
    adminKey: value("CONSOLE_ADMIN_ACCESS_KEY"),
    credentialSalt: value("CONSOLE_CREDENTIAL_SALT"),
    origin: value("CONSOLE_ORIGIN"),
    allowedOrigins: value("CONSOLE_ALLOWED_ORIGINS")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    emails: parsed.data,
    team: value("CONSOLE_ACCESS_TEAM_DOMAIN"),
    audience: value("CONSOLE_ACCESS_AUD"),
  };
}
export function localConsole(request: Request, config: ConsoleBindings) {
  const url = new URL(request.url);
  return (
    config.environment === "local" &&
    config.mode === "local_key" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    config.localKey.length >= 40
  );
}
function accessConfig(config: ConsoleBindings) {
  if (
    config.mode !== "access" ||
    !/^[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/.test(config.team) ||
    !/^[a-f0-9]{32,128}$/.test(config.audience)
  )
    throw new ApiError("SERVICE_UNAVAILABLE", "管理员登录尚未配置。");
  return { issuer: `https://${config.team}`, audience: config.audience };
}
export function consoleMode(request: Request, config: ConsoleBindings) {
  if (localConsole(request, config)) return "local" as const;
  if (["admin_key", "admin_password"].includes(config.mode)) {
    const url = new URL(request.url);
    const allowedOrigins = [config.origin, ...(config.allowedOrigins || [])]
      .filter((origin): origin is string => Boolean(origin))
      .some((origin) => {
        try {
          const configured = new URL(origin);
          return (
            configured.protocol === "https:" &&
            configured.origin === origin &&
            configured.origin === url.origin
          );
        } catch {
          return false;
        }
      });
    if (
      !["preview", "production"].includes(config.environment) ||
      url.protocol !== "https:" ||
      !allowedOrigins ||
      config.emails.length !== 1 ||
      !config.adminKey ||
      config.adminKey.length < 40 ||
      config.adminKey.length > 200 ||
      (config.mode === "admin_password" &&
        (!/^[a-f0-9]{64}$/.test(config.credentialSalt || "") ||
          !/^[a-f0-9]{64}$/.test(config.adminKey)))
    )
      throw new ApiError("SERVICE_UNAVAILABLE", "管理员登录尚未配置。");
    return "key" as const;
  }
  accessConfig(config);
  return "access" as const;
}
function consoleCredential(mode: "local" | "key", config: ConsoleBindings) {
  return mode === "local"
    ? { prefix: "local:", key: config.localKey }
    : { prefix: "admin_key:", key: config.adminKey! };
}
export async function verifyConsoleAccess(
  token: string,
  config: ConsoleBindings,
  keyResolver?: JWTVerifyGetKey,
  now = Date.now(),
) {
  const { issuer, audience } = accessConfig(config);
  try {
    if (!token || token.length > 16000) throw Error();
    let resolver = keyResolver || keys.get(issuer);
    if (!resolver) {
      if (keys.size >= 4) keys.clear();
      const remote = createRemoteJWKSet(
        new URL(issuer + "/cdn-cgi/access/certs"),
        {
          cacheMaxAge: 300000,
          cooldownDuration: 30000,
          timeoutDuration: 4000,
        },
      );
      keys.set(issuer, remote);
      resolver = remote;
    }
    const { payload } = await jwtVerify(token, resolver, {
      issuer,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub", "email"],
      clockTolerance: 10,
      maxTokenAge: "24h",
      currentDate: new Date(now),
    });
    const email = z.email().toLowerCase().parse(payload.email);
    if (
      !payload.sub ||
      !payload.exp ||
      !config.emails.includes(email) ||
      payload.type !== "app"
    )
      throw Error();
    return {
      email,
      subject: payload.sub,
      accessHash: await tokenHash(token),
      expiresAt: payload.exp * 1000,
    };
  } catch {
    throw new ApiError("UNAUTHORIZED", "管理员身份无效或已撤销。");
  }
}
export async function consoleLimit(
  config: ConsoleBindings,
  key: string,
  limit: number,
  now = Date.now(),
) {
  const keyHash = await tokenHash("console-limit:" + config.secret + ":" + key),
    bucket = Math.floor(now / 60000);
  const value = await config.db
    .prepare(
      "INSERT INTO console_limits(key_hash,bucket,requests) VALUES(?,?,1) ON CONFLICT(key_hash,bucket) DO UPDATE SET requests=requests+1 RETURNING requests",
    )
    .bind(keyHash, bucket)
    .first<{ requests: number }>();
  if (!value || value.requests > limit)
    throw new ApiError("RATE_LIMITED", "管理请求过于频繁，请稍后重试。", true);
}
function cookie(request: Request) {
  return (
    request.headers
      .get("Cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) || ""
  );
}
export function consoleCookie(request: Request, token: string, clear = false) {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 3600}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function consoleCsrf(raw: string, config: ConsoleBindings) {
  // Return only the MAC. signData's payload contains the HttpOnly token and
  // must never be sent to the client, even base64 encoded.
  return (await signData(["console-csrf-v1", raw], config.secret)).split(
    ".",
  )[1];
}
async function equal(a: string, b: string) {
  const x = await tokenHash(a),
    y = await tokenHash(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
export async function createConsoleSession(
  request: Request,
  body: unknown,
  config = consoleBindings(),
  now = Date.now(),
  resolver?: JWTVerifyGetKey,
) {
  sameOrigin(request);
  const mode = consoleMode(request, config);
  if (config.mode === "admin_password")
    await consoleLimit(config, "password-login:global", 10, now);
  await consoleLimit(
    config,
    "login:" + (request.headers.get("CF-Connecting-IP") || "local"),
    5,
    now,
  );
  let identity: {
    email: string;
    subject: string;
    accessHash: string;
    expiresAt: number;
  };
  if (mode === "local" || mode === "key") {
    const credential = consoleCredential(mode, config);
    const parsed = z
      .object({ key: z.string().min(40).max(200) })
      .strict()
      .parse(body);
    const presented =
      config.mode === "admin_password"
        ? await tokenHash(parsed.key)
        : parsed.key;
    if (!(await equal(presented, credential.key)))
      throw new ApiError("UNAUTHORIZED", "管理员身份无效或已撤销。");
    identity = {
      email: config.emails[0],
      subject: credential.prefix + config.emails[0],
      accessHash: await tokenHash(credential.prefix + credential.key),
      expiresAt: now + 3600000,
    };
  } else {
    z.object({}).strict().parse(body);
    identity = await verifyConsoleAccess(
      request.headers.get("Cf-Access-Jwt-Assertion") || "",
      config,
      resolver,
      now,
    );
  }
  if (
    await config.db
      .prepare(
        "SELECT token_hash FROM console_revoked_tokens WHERE token_hash=? AND expires_at_ms>?",
      )
      .bind(identity.accessHash, now)
      .first()
  )
    throw new ApiError("UNAUTHORIZED", "管理员身份无效或已撤销。");
  const id = "admin-" + (await tokenHash(identity.email)).slice(0, 32);
  await config.db
    .prepare(
      "INSERT OR IGNORE INTO console_admins(id,email,role) VALUES(?,?,'admin')",
    )
    .bind(id, identity.email)
    .run();
  const admin = await config.db
    .prepare(
      "SELECT id,email,role,status FROM console_admins WHERE id=? AND status='active'",
    )
    .bind(id)
    .first<ConsoleActor & { status: string }>();
  if (!admin) throw new ApiError("FORBIDDEN", "管理员身份无效或已撤销。");
  const token = randomToken(),
    hash = await tokenHash(token);
  await config.db.batch([
    config.db
      .prepare("DELETE FROM console_sessions WHERE expires_at_ms<=?")
      .bind(now),
    config.db
      .prepare("DELETE FROM console_revoked_tokens WHERE expires_at_ms<=?")
      .bind(now),
    config.db
      .prepare("DELETE FROM console_limits WHERE bucket<?")
      .bind(Math.floor(now / 60000) - 60),
    config.db
      .prepare(
        "INSERT INTO console_sessions(token_hash,admin_id,access_hash,expires_at_ms,created_at_ms) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM console_admins WHERE id=? AND status='active')",
      )
      .bind(
        hash,
        id,
        identity.accessHash,
        Math.min(identity.expiresAt, now + 3600000),
        now,
        id,
      ),
    config.db
      .prepare(
        "INSERT INTO console_audit_logs(id,actor_id,actor_label,action,target_type,target_id) VALUES(?,?,?,'auth.login','admin',?)",
      )
      .bind(crypto.randomUUID(), id, admin.email, id),
  ]);
  return {
    actor: {
      id: admin.id,
      email: admin.email,
      role: roleSchema.parse(admin.role),
    },
    csrf: await consoleCsrf(token, config),
    cookie: consoleCookie(request, token),
  };
}
export async function requireConsole(
  request: Request,
  write = false,
  config = consoleBindings(),
  now = Date.now(),
  resolver?: JWTVerifyGetKey,
  logoutOnly = false,
) {
  sameOrigin(request);
  const mode = consoleMode(request, config);
  const raw = cookie(request);
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(raw))
    throw new ApiError("UNAUTHORIZED", "请先登录管理后台。");
  const tokenHashValue = await tokenHash(raw);
  const row = await config.db
    .prepare(
      "SELECT a.id,a.email,a.role,s.access_hash,s.expires_at_ms FROM console_sessions s JOIN console_admins a ON a.id=s.admin_id WHERE s.token_hash=? AND s.revoked_at_ms IS NULL AND s.expires_at_ms>? AND a.status='active'",
    )
    .bind(tokenHashValue, now)
    .first<ConsoleActor & { access_hash: string; expires_at_ms: number }>();
  if (!row) throw new ApiError("UNAUTHORIZED", "管理员身份无效或已撤销。");
  if (
    (mode === "local" || mode === "key") &&
    (row.access_hash !==
      (await tokenHash(
        consoleCredential(mode, config).prefix +
          consoleCredential(mode, config).key,
      )) ||
      !config.emails.includes(row.email))
  )
    throw new ApiError("UNAUTHORIZED", "管理员身份无效或已撤销。");
  if (!logoutOnly && mode === "access") {
    const identity = await verifyConsoleAccess(
      request.headers.get("Cf-Access-Jwt-Assertion") || "",
      config,
      resolver,
      now,
    );
    if (
      identity.email !== row.email ||
      (await config.db
        .prepare(
          "SELECT token_hash FROM console_revoked_tokens WHERE token_hash=? AND expires_at_ms>?",
        )
        .bind(identity.accessHash, now)
        .first())
    )
      throw new ApiError("FORBIDDEN", "管理员身份无效或已撤销。");
  }
  const csrf = await consoleCsrf(raw, config);
  if (
    write &&
    !(await equal(request.headers.get("X-Console-CSRF") || "", csrf))
  )
    throw new ApiError("FORBIDDEN", "请求校验失败，请刷新后重试。");
  await consoleLimit(config, "session:" + row.id, 120, now);
  return {
    actor: { id: row.id, email: row.email, role: roleSchema.parse(row.role) },
    csrf,
    config,
    sessionHash: tokenHashValue,
    accessHash: row.access_hash,
    expiresAt: row.expires_at_ms,
  };
}
export function consolePermission(actor: ConsoleActor, operation: string) {
  const can =
    actor.role === "admin" ||
    operation === "read" ||
    (operation === "review" && ["reviewer", "operator"].includes(actor.role)) ||
    (operation === "write" && actor.role === "operator");
  if (!can) throw new ApiError("FORBIDDEN", "没有执行此操作的管理权限。");
}
export async function closeConsoleSession(
  request: Request,
  context: Awaited<ReturnType<typeof requireConsole>>,
) {
  const { config, actor } = context;
  const hash = request.headers.get("Cf-Access-Jwt-Assertion")
    ? await tokenHash(request.headers.get("Cf-Access-Jwt-Assertion")!)
    : context.accessHash;
  await config.db.batch([
    config.db
      .prepare(
        "UPDATE console_sessions SET revoked_at_ms=? WHERE token_hash=? AND admin_id=?",
      )
      .bind(Date.now(), context.sessionHash, actor.id),
    // Key sessions are revoked individually; rotating the key invalidates all.
    // Access JWTs are additionally revoked for this Console.
    ...(config.mode === "access"
      ? [
          config.db
            .prepare(
              "INSERT OR REPLACE INTO console_revoked_tokens(token_hash,expires_at_ms) VALUES(?,?)",
            )
            .bind(hash, Date.now() + 86400000),
          config.db
            .prepare(
              "INSERT OR REPLACE INTO console_revoked_tokens(token_hash,expires_at_ms) VALUES(?,?)",
            )
            .bind(context.accessHash, Date.now() + 86400000),
        ]
      : []),
    config.db
      .prepare(
        "INSERT INTO console_audit_logs(id,actor_id,actor_label,action,target_type,target_id) VALUES(?,?,?,'auth.logout','admin',?)",
      )
      .bind(crypto.randomUUID(), actor.id, actor.email, actor.id),
  ]);
  return consoleCookie(request, "", true);
}
export type { ConsoleRole };
