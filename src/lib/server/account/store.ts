import type { SqlDatabase, Statement } from "../assistant/database";
import { randomToken, tokenHash } from "../assistant/crypto";
import { ApiError } from "../errors";
import {
  RegisterSchema,
  LoginSchema,
  RenameSchema,
  PasswordChangeSchema,
  type AccountProfile,
} from "@/domain/account/contracts";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "./password";
import { authLimit, cookieValue, SESSION_MS } from "./security";

export type PasswordDriver = {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
};
export type MailMessage = {
  to: string;
  subject: string;
  key: string;
  purpose: "code";
  code: string;
};
export type AccountMailer = {
  available: boolean;
  send(message: MailMessage): Promise<void>;
};
export type AccountRow = {
  user_id: string;
  username: string;
  username_norm: string;
  password_hash: string;
  verified_email: string | null;
  pending_email: string | null;
  email_verified_at_ms: number | null;
  auth_version: number;
  email_epoch: number;
  revision: number;
  username_changed_at_ms: number;
  created_at: string;
};
export type AccountSession = {
  hash: string;
  row: AccountRow;
  expiresAt: number;
};
const genericLogin = () =>
  new ApiError("UNAUTHORIZED", "用户名或邮箱与密码不匹配。");
export const changed = (r: unknown) =>
  Number((r as { meta?: { changes?: number } })?.meta?.changes || 0);
export class AccountStore {
  readonly now: () => number;
  readonly passwords: PasswordDriver;
  readonly mailer: AccountMailer;
  readonly origin: string;
  readonly allowedOrigins: readonly string[];
  readonly otpSecret: string;
  constructor(
    readonly db: SqlDatabase,
    options: {
      now?: () => number;
      passwords?: PasswordDriver;
      mailer?: AccountMailer;
      origin: string;
      allowedOrigins?: readonly string[];
      otpSecret?: string;
    },
  ) {
    this.now = options.now || Date.now;
    this.origin = options.origin;
    this.allowedOrigins = [
      ...new Set([options.origin, ...(options.allowedOrigins || [])]),
    ];
    this.otpSecret = options.otpSecret || "";
    this.passwords = options.passwords || {
      hash: hashPassword,
      verify: verifyPassword,
    };
    this.mailer = options.mailer || {
      available: false,
      async send() {
        throw new ApiError("SERVICE_UNAVAILABLE", "邮件验证暂不可用。", true);
      },
    };
  }
  profile(row: AccountRow): AccountProfile {
    return {
      id: row.user_id,
      username: row.username,
      email: row.verified_email,
      pendingEmail: row.pending_email,
      emailVerified: row.verified_email !== null,
      createdAt: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.created_at)
        ? row.created_at.replace(" ", "T") + "Z"
        : row.created_at,
    };
  }
  async resolve(request: Request): Promise<AccountSession | null> {
    const token = cookieValue(request);
    if (!token) return null;
    const hash = await tokenHash(token),
      now = this.now();
    const row = await this.db
      .prepare(
        `SELECT i.*,u.created_at,s.expires_at,s.last_seen_at_ms FROM login_sessions s JOIN users u ON u.id=s.user_id JOIN user_password_identities i ON i.user_id=u.id WHERE s.session_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.auth_version=i.auth_version AND u.role='user' AND u.status='active'`,
      )
      .bind(hash, new Date(now).toISOString())
      .first<AccountRow & { expires_at: string; last_seen_at_ms: number }>();
    if (!row) return null;
    if (row.last_seen_at_ms < now - 900000)
      await this.db
        .prepare(
          "UPDATE login_sessions SET last_seen_at_ms=? WHERE session_hash=? AND last_seen_at_ms<?",
        )
        .bind(now, hash, now - 900000)
        .run();
    return { hash, row, expiresAt: Date.parse(row.expires_at) };
  }
  async require(request: Request) {
    const session = await this.resolve(request);
    if (!session) throw new ApiError("UNAUTHORIZED", "请先登录账号。");
    return session;
  }
  async limit(action: string, ip: string, subject?: string) {
    const now = this.now();
    await authLimit(
      this.db,
      action + ":ip",
      ip,
      action === "register"
        ? 10
        : action === "article_favorites"
          ? 240
          : 60,
      600000,
      now,
    );
    if (subject)
      await authLimit(
        this.db,
        action + ":subject",
        subject,
        action === "model_settings"
          ? 40
          : action === "article_favorites"
            ? 120
            : 10,
        900000,
        now,
      );
    await authLimit(
      this.db,
      action + ":site",
      "site",
      action === "register" ? 100 : 300,
      600000,
      now,
    );
  }
  auditGuard(kind: string, id: string, nonce: string) {
    return this.db
      .prepare(
        "INSERT INTO user_auth_events(id,user_id,kind,created_at_ms) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM user_password_identities WHERE user_id=? AND mutation_id=?)",
      )
      .bind(crypto.randomUUID(), id, kind, this.now(), id, nonce);
  }
  event(kind: string, id: string | null) {
    return this.db
      .prepare(
        "INSERT INTO user_auth_events(id,user_id,kind,created_at_ms) VALUES(?,?,?,?)",
      )
      .bind(crypto.randomUUID(), id, kind, this.now());
  }
  guard() {
    return `EXISTS(SELECT 1 FROM login_sessions s JOIN users u ON u.id=s.user_id JOIN user_password_identities p ON p.user_id=u.id WHERE s.session_hash=? AND s.user_id=user_password_identities.user_id AND s.revoked_at IS NULL AND s.expires_at>? AND s.auth_version=p.auth_version AND u.status='active' AND u.role='user')`;
  }
  sessionStatement(hash: string, userId: string, version: number, now: number) {
    return this.db
      .prepare(
        `INSERT INTO login_sessions(session_hash,user_id,expires_at,auth_version,last_seen_at_ms) SELECT ?,u.id,?,?,? FROM users u JOIN user_password_identities i ON i.user_id=u.id WHERE u.id=? AND u.role='user' AND u.status='active' AND i.auth_version=?`,
      )
      .bind(
        hash,
        new Date(now + SESSION_MS).toISOString(),
        version,
        now,
        userId,
        version,
      );
  }
  async row(id: string) {
    return this.db
      .prepare(
        "SELECT i.*,u.created_at FROM user_password_identities i JOIN users u ON u.id=i.user_id WHERE i.user_id=? AND u.status='active' AND u.role='user'",
      )
      .bind(id)
      .first<AccountRow>();
  }
  async register(
    raw: unknown,
    request: Request,
    ip: string,
    proof?: { hash: string; digest: string },
  ) {
    const input = RegisterSchema.parse(raw),
      norm = input.username.toLowerCase();
    await this.limit("register", ip, norm);
    if (
      await this.db
        .prepare(
          "SELECT user_id FROM user_password_identities WHERE username_norm=?",
        )
        .bind(norm)
        .first()
    )
      throw new ApiError("CONFLICT", "用户名不可用，请更换用户名。");
    if (input.email && !proof)
      throw new ApiError("FORBIDDEN", "请先验证邮箱。");
    const hash = await this.passwords.hash(input.password),
      id = crypto.randomUUID(),
      token = randomToken(),
      sessionHash = await tokenHash(token),
      now = this.now(),
      nonce = crypto.randomUUID();
    const proofGuard = proof
      ? " AND EXISTS(SELECT 1 FROM user_auth_tokens WHERE token_hash=? AND consumption_id=?)"
      : "";
    const proofValues = proof ? [proof.hash, nonce] : [];
    const statements: Statement[] = [
      ...(proof
        ? [
            this.db
              .prepare(
                "UPDATE user_auth_tokens SET used_at_ms=?,consumption_id=?,attempts=attempts+1 WHERE token_hash=? AND code_hash=? AND purpose='register_email' AND username_norm=? AND email=? AND used_at_ms IS NULL AND attempts<5 AND expires_at_ms>? AND NOT EXISTS(SELECT 1 FROM user_password_identities WHERE verified_email=user_auth_tokens.email)",
              )
              .bind(
                now,
                nonce,
                proof.hash,
                proof.digest,
                norm,
                input.email,
                now,
              ),
          ]
        : []),
      this.db
        .prepare(
          "INSERT INTO users(id,display_name,role,status) SELECT ?,?,'user','active' WHERE 1=1" +
            proofGuard,
        )
        .bind(id, input.username, ...proofValues),
      this.db
        .prepare(
          "INSERT INTO user_password_identities(user_id,username,username_norm,password_hash,verified_email,email_verified_at_ms,mutation_id,updated_at_ms) SELECT id,?,?,?,?,?,?,? FROM users WHERE id=?",
        )
        .bind(
          input.username,
          norm,
          hash,
          input.email || null,
          input.email ? now : null,
          nonce,
          now,
          id,
        ),
      this.sessionStatement(sessionHash, id, 1, now),
      this.db
        .prepare(
          "INSERT INTO user_auth_events(id,user_id,kind,created_at_ms) SELECT ?,id,'register',? FROM users WHERE id=?",
        )
        .bind(crypto.randomUUID(), now, id),
    ];
    const old = cookieValue(request);
    if (old)
      statements.push(
        this.db
          .prepare(
            "UPDATE login_sessions SET revoked_at=? WHERE session_hash=? AND EXISTS(SELECT 1 FROM users WHERE id=?)",
          )
          .bind(new Date(now).toISOString(), await tokenHash(old), id),
      );
    try {
      const results = await this.db.batch(statements);
      if (proof && !changed(results[0]))
        throw new ApiError(
          "FORBIDDEN",
          "验证码无效、已使用或已过期，请重新发送。",
        );
    } catch (e) {
      if (/UNIQUE constraint/i.test(String(e)))
        throw new ApiError("CONFLICT", "用户名或邮箱不可用，请更换后重试。");
      throw e;
    }
    return {
      token,
      expiresAt: now + SESSION_MS,
      profile: this.profile((await this.row(id))!),
    };
  }
  async login(raw: unknown, request: Request, ip: string) {
    const input = LoginSchema.parse(raw),
      identifier = input.identifier.toLowerCase();
    await this.limit("login", ip, identifier);
    const row = await this.db
      .prepare(
        `SELECT i.*,u.created_at FROM user_password_identities i JOIN users u ON u.id=i.user_id WHERE ${identifier.includes("@") ? "i.verified_email=? AND i.email_verified_at_ms IS NOT NULL" : "i.username_norm=?"} AND u.status='active' AND u.role='user'`,
      )
      .bind(identifier)
      .first<AccountRow>();
    if (row)
      await authLimit(
        this.db,
        "login:account",
        row.user_id,
        10,
        900000,
        this.now(),
      );
    const verified = await this.passwords.verify(
      input.password,
      row?.password_hash || DUMMY_PASSWORD_HASH,
    );
    if (!row || !verified) {
      await this.event("login_failed", null).run();
      throw genericLogin();
    }
    const token = randomToken(),
      hash = await tokenHash(token),
      now = this.now();
    const old = cookieValue(request);
    const results = await this.db.batch([
      this.sessionStatement(hash, row.user_id, row.auth_version, now),
      ...(old
        ? [
            this.db
              .prepare(
                "UPDATE login_sessions SET revoked_at=? WHERE session_hash=? AND session_hash<>? AND EXISTS(SELECT 1 FROM login_sessions new_session WHERE new_session.session_hash=?)",
              )
              .bind(
                new Date(now).toISOString(),
                await tokenHash(old),
                hash,
                hash,
              ),
          ]
        : []),
      this.db
        .prepare(
          "INSERT INTO user_auth_events(id,user_id,kind,created_at_ms) SELECT ?,?,'login',? WHERE EXISTS(SELECT 1 FROM login_sessions WHERE session_hash=?)",
        )
        .bind(crypto.randomUUID(), row.user_id, now, hash),
    ]);
    if (!changed(results[0])) throw genericLogin();
    return { token, expiresAt: now + SESSION_MS, profile: this.profile(row) };
  }
  async logout(request: Request) {
    const token = cookieValue(request);
    if (token) {
      const hash = await tokenHash(token);
      await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO user_auth_events(id,user_id,kind,created_at_ms) SELECT ?,user_id,'logout',? FROM login_sessions WHERE session_hash=? AND revoked_at IS NULL",
          )
          .bind(crypto.randomUUID(), this.now(), hash),
        this.db
          .prepare(
            "UPDATE login_sessions SET revoked_at=? WHERE session_hash=? AND revoked_at IS NULL",
          )
          .bind(new Date(this.now()).toISOString(), hash),
      ]);
    }
    return { loggedOut: true };
  }
  async verifyCurrent(session: AccountSession, password: string) {
    await authLimit(
      this.db,
      "reauth",
      session.row.user_id,
      10,
      900000,
      this.now(),
    );
    if (!(await this.passwords.verify(password, session.row.password_hash)))
      throw new ApiError("UNAUTHORIZED", "当前密码不正确。");
  }
  async rename(raw: unknown, request: Request) {
    const input = RenameSchema.parse(raw),
      s = await this.require(request);
    const now = this.now();
    const nonce = crypto.randomUUID();
    let results: unknown[];
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `UPDATE user_password_identities SET username=?,username_norm=?,username_changed_at_ms=?,updated_at_ms=?,revision=revision+1,mutation_id=? WHERE user_id=? AND revision=? AND password_hash=? AND ${this.guard()}`,
          )
          .bind(
            input.username,
            input.username.toLowerCase(),
            now,
            now,
            nonce,
            s.row.user_id,
            s.row.revision,
            s.row.password_hash,
            s.hash,
            new Date(now).toISOString(),
          ),
        this.db
          .prepare(
            "UPDATE users SET display_name=? WHERE id=? AND EXISTS(SELECT 1 FROM user_password_identities WHERE user_id=users.id AND mutation_id=?)",
          )
          .bind(input.username, s.row.user_id, nonce),
        this.auditGuard("username_changed", s.row.user_id, nonce),
      ]);
    } catch (e) {
      if (/UNIQUE constraint/i.test(String(e)))
        throw new ApiError("CONFLICT", "用户名不可用，请更换用户名。");
      throw e;
    }
    if (!changed(results[0]))
      throw new ApiError("CONFLICT", "账号状态已更新，请刷新后重试。");
    return this.profile((await this.row(s.row.user_id))!);
  }
  async changePassword(raw: unknown, request: Request) {
    const input = PasswordChangeSchema.parse(raw),
      s = await this.require(request);
    await this.verifyCurrent(s, input.currentPassword);
    const hash = await this.passwords.hash(input.newPassword),
      nonce = crypto.randomUUID(),
      now = this.now(),
      token = randomToken(),
      sessionHash = await tokenHash(token);
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE user_password_identities SET password_hash=?,auth_version=auth_version+1,email_epoch=email_epoch+1,revision=revision+1,updated_at_ms=?,mutation_id=? WHERE user_id=? AND revision=? AND password_hash=? AND ${this.guard()}`,
        )
        .bind(
          hash,
          now,
          nonce,
          s.row.user_id,
          s.row.revision,
          s.row.password_hash,
          s.hash,
          new Date(now).toISOString(),
        ),
      this.db
        .prepare(
          "UPDATE login_sessions SET revoked_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM user_password_identities WHERE user_id=? AND mutation_id=?)",
        )
        .bind(new Date(now).toISOString(), s.row.user_id, s.row.user_id, nonce),
      this.db
        .prepare(
          `INSERT INTO login_sessions(session_hash,user_id,expires_at,auth_version,last_seen_at_ms) SELECT ?,user_id,?,auth_version,? FROM user_password_identities WHERE user_id=? AND mutation_id=?`,
        )
        .bind(
          sessionHash,
          new Date(now + SESSION_MS).toISOString(),
          now,
          s.row.user_id,
          nonce,
        ),
      this.db
        .prepare(
          "UPDATE user_auth_tokens SET used_at_ms=?,consumption_id=? WHERE user_id=? AND used_at_ms IS NULL AND EXISTS(SELECT 1 FROM user_password_identities WHERE user_id=? AND mutation_id=?)",
        )
        .bind(now, nonce, s.row.user_id, s.row.user_id, nonce),
      this.auditGuard("password_changed", s.row.user_id, nonce),
    ]);
    if (!changed(results[0]))
      throw new ApiError("CONFLICT", "账号状态已更新，请刷新后重试。");
    return {
      token,
      expiresAt: now + SESSION_MS,
      profile: this.profile((await this.row(s.row.user_id))!),
    };
  }
}
