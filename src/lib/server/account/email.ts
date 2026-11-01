import {
  RegisterSchema,
  RegistrationCodeSchema,
  EmailBindSchema,
  EmailUnbindSchema,
  ResetRequestSchema,
  ResetConfirmSchema,
  VerifyEmailSchema,
} from "@/domain/account/contracts";
import { ApiError } from "../errors";
import { randomToken, tokenHash } from "../assistant/crypto";
import { AccountStore, changed } from "./store";
import { authLimit } from "./security";
import { emailCode, codeDigest, sameDigest } from "./otp";
type Ticket = {
  user_id: string;
  email: string;
  verified_email: string | null;
  username: string;
  code_hash: string;
  auth_version: number;
  email_epoch: number;
};
const invalidCode = () =>
  new ApiError("FORBIDDEN", "验证码无效、已使用或已过期，请重新发送。");
export class AccountService extends AccountStore {
  async mailLimit(email: string, userId?: string, purpose = "verify") {
    const n = this.now();
    await authLimit(this.db, "mail:minute:" + purpose, email, 1, 60000, n);
    await authLimit(this.db, "mail:hour", email, 5, 3600000, n);
    if (userId) await authLimit(this.db, "mail:user", userId, 8, 3600000, n);
    await authLimit(this.db, "mail:site", "site", 300, 86400000, n);
  }
  async code(
    purpose:
      "register_email" | "verify_email" | "reset_password" | "unbind_email",
  ) {
    const challenge = randomToken(),
      value = emailCode();
    return {
      challenge,
      value,
      hash: await tokenHash(challenge),
      digest: await codeDigest(this.otpSecret, purpose, challenge, value),
    };
  }
  deliver(
    email: string,
    code: { hash: string; value: string },
    purpose:
      "register_email" | "verify_email" | "reset_password" | "unbind_email",
  ) {
    return this.mailer.send({
      to: email,
      purpose: "code",
      code: code.value,
      key: purpose + "-" + code.hash,
      subject:
        purpose !== "reset_password"
          ? "CampusOS 广外通：邮箱验证"
          : "CampusOS 广外通：找回密码",
    });
  }
  async registrationCode(raw: unknown, ip: string) {
    const input = RegistrationCodeSchema.parse(raw);
    await this.limit("registration_code", ip, input.email);
    if (!this.mailer.available)
      throw new ApiError("SERVICE_UNAVAILABLE", "邮件暂时无法发送。", true);
    if (
      await this.db
        .prepare(
          "SELECT user_id FROM user_password_identities WHERE username_norm=?",
        )
        .bind(input.username.toLowerCase())
        .first()
    )
      throw new ApiError("CONFLICT", "用户名已被使用。");
    if (
      await this.db
        .prepare(
          "SELECT user_id FROM user_password_identities WHERE verified_email=?",
        )
        .bind(input.email)
        .first()
    )
      throw new ApiError("CONFLICT", "邮箱已被绑定。");
    await this.mailLimit(input.email, undefined, "registration");
    const c = await this.code("register_email"),
      n = this.now();
    await this.db
      .prepare(
        "INSERT INTO user_auth_tokens(token_hash,code_hash,purpose,username_norm,email,auth_version,email_epoch,created_at_ms,expires_at_ms) VALUES(?,?,'register_email',?,?,0,0,?,?)",
      )
      .bind(
        c.hash,
        c.digest,
        input.username.toLowerCase(),
        input.email,
        n,
        n + 600000,
      )
      .run();
    await this.deliver(input.email, c, "register_email");
    return { challenge: c.challenge };
  }
  override async register(raw: unknown, request: Request, ip: string) {
    const input = RegisterSchema.parse(raw);
    if (!input.email) return super.register(input, request, ip);
    await this.limit("register_confirm", ip);
    const hash = await tokenHash(input.challenge!);
    const row = await this.db
      .prepare(
        "SELECT code_hash FROM user_auth_tokens WHERE token_hash=? AND purpose='register_email' AND email=? AND username_norm=? AND used_at_ms IS NULL AND attempts<5 AND expires_at_ms>?",
      )
      .bind(hash, input.email, input.username.toLowerCase(), this.now())
      .first<{ code_hash: string }>();
    if (!row) throw invalidCode();
    const digest = await this.checkCode(
      input.challenge!,
      input.code!,
      "register_email",
      row,
    );
    return super.register(input, request, ip, { hash, digest });
  }
  async requestEmail(raw: unknown, request: Request) {
    const input = EmailBindSchema.parse(raw),
      s = await this.require(request);
    if (!this.mailer.available)
      throw new ApiError(
        "SERVICE_UNAVAILABLE",
        "邮箱验证暂不可用，可继续使用用户名登录。",
        true,
      );

    if (
      await this.db
        .prepare(
          "SELECT user_id FROM user_password_identities WHERE verified_email=? AND user_id<>?",
        )
        .bind(input.email, s.row.user_id)
        .first()
    )
      throw new ApiError("CONFLICT", "该邮箱暂不可绑定，请更换邮箱。");
    if (s.row.verified_email && input.email !== s.row.verified_email)
      throw new ApiError("CONFLICT", "请先解绑当前邮箱。");
    if (input.email === s.row.verified_email)
      throw new ApiError("CONFLICT", "此邮箱已经验证。");
    await this.mailLimit(input.email, s.row.user_id);
    const c = await this.code("verify_email"),
      nonce = crypto.randomUUID(),
      n = this.now();
    const r = await this.db.batch([
      this.db
        .prepare(
          `UPDATE user_password_identities SET pending_email=?,email_epoch=email_epoch+1,revision=revision+1,mutation_id=?,updated_at_ms=? WHERE user_id=? AND revision=? AND password_hash=? AND ${this.guard()}`,
        )
        .bind(
          input.email,
          nonce,
          n,
          s.row.user_id,
          s.row.revision,
          s.row.password_hash,
          s.hash,
          new Date(n).toISOString(),
        ),
      this.db
        .prepare(
          `INSERT INTO user_auth_tokens(token_hash,code_hash,user_id,purpose,email,auth_version,email_epoch,created_at_ms,expires_at_ms) SELECT ?,?,user_id,'verify_email',pending_email,auth_version,email_epoch,?,? FROM user_password_identities WHERE user_id=? AND mutation_id=?`,
        )
        .bind(c.hash, c.digest, n, n + 600000, s.row.user_id, nonce),
      this.auditGuard("email_requested", s.row.user_id, nonce),
    ]);
    if (!changed(r[0]))
      throw new ApiError("CONFLICT", "账号状态已更新，请刷新后重试。");
    await this.deliver(input.email, c, "verify_email");
    return {
      user: this.profile((await this.row(s.row.user_id))!),
      challenge: c.challenge,
    };
  }
  ticketGuard() {
    return `EXISTS(SELECT 1 FROM user_password_identities i JOIN users u ON u.id=i.user_id WHERE i.user_id=user_auth_tokens.user_id AND i.auth_version=user_auth_tokens.auth_version AND i.email_epoch=user_auth_tokens.email_epoch AND u.status='active' AND u.role='user' AND ((user_auth_tokens.purpose='verify_email' AND i.pending_email=user_auth_tokens.email) OR (user_auth_tokens.purpose='reset_password' AND i.verified_email=user_auth_tokens.email AND i.email_verified_at_ms IS NOT NULL) OR (user_auth_tokens.purpose='unbind_email' AND COALESCE(i.verified_email,i.pending_email)=user_auth_tokens.email)))`;
  }
  async ticket(challenge: string, purpose: string, userId?: string) {
    return this.db
      .prepare(
        `SELECT t.*,i.username,i.verified_email FROM user_auth_tokens t JOIN user_password_identities i ON i.user_id=t.user_id JOIN users u ON u.id=i.user_id WHERE t.token_hash=? AND t.purpose=? AND t.used_at_ms IS NULL AND t.attempts<5 AND t.expires_at_ms>? AND t.auth_version=i.auth_version AND t.email_epoch=i.email_epoch AND u.status='active' AND u.role='user' AND ${purpose === "verify_email" ? "i.pending_email=t.email" : purpose === "unbind_email" ? "COALESCE(i.verified_email,i.pending_email)=t.email" : "i.verified_email=t.email AND i.email_verified_at_ms IS NOT NULL"} ${userId ? "AND t.user_id=?" : ""}`,
      )
      .bind(
        await tokenHash(challenge),
        purpose,
        this.now(),
        ...(userId ? [userId] : []),
      )
      .first<Ticket>();
  }
  async checkCode(
    challenge: string,
    value: string,
    purpose: string,
    row: { code_hash: string },
  ) {
    const digest = await codeDigest(this.otpSecret, purpose, challenge, value);
    if (!sameDigest(digest, row.code_hash)) {
      await this.db
        .prepare(
          "UPDATE user_auth_tokens SET attempts=attempts+1 WHERE token_hash=? AND purpose=? AND used_at_ms IS NULL AND attempts<5 AND expires_at_ms>?",
        )
        .bind(await tokenHash(challenge), purpose, this.now())
        .run();
      throw invalidCode();
    }
    return digest;
  }
  claim(
    hash: string,
    digest: string,
    purpose: string,
    nonce: string,
    n: number,
    session?: { hash: string },
  ) {
    return this.db
      .prepare(
        `UPDATE user_auth_tokens SET used_at_ms=?,consumption_id=?,attempts=attempts+1 WHERE token_hash=? AND code_hash=? AND purpose=? AND used_at_ms IS NULL AND attempts<5 AND expires_at_ms>? AND ${this.ticketGuard()} ${session ? `AND EXISTS(SELECT 1 FROM login_sessions s WHERE s.session_hash=? AND s.user_id=user_auth_tokens.user_id AND s.revoked_at IS NULL AND s.expires_at>? AND s.auth_version=user_auth_tokens.auth_version)` : ""}`,
      )
      .bind(
        n,
        nonce,
        hash,
        digest,
        purpose,
        n,
        ...(session ? [session.hash, new Date(n).toISOString()] : []),
      );
  }
  auditGuard(kind: string, id: string, nonce: string) {
    return this.db
      .prepare(
        "INSERT INTO user_auth_events(id,user_id,kind,created_at_ms) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM user_password_identities WHERE user_id=? AND mutation_id=?)",
      )
      .bind(crypto.randomUUID(), id, kind, this.now(), id, nonce);
  }
  revokeTickets(id: string, nonce: string, n: number) {
    return this.db
      .prepare(
        "UPDATE user_auth_tokens SET used_at_ms=?,consumption_id=? WHERE user_id=? AND used_at_ms IS NULL AND EXISTS(SELECT 1 FROM user_password_identities WHERE user_id=? AND mutation_id=?)",
      )
      .bind(n, nonce, id, id, nonce);
  }
  async verifyEmail(raw: unknown, request: Request) {
    const input = VerifyEmailSchema.parse(raw),
      s = await this.require(request),
      row = await this.ticket(input.challenge, "verify_email", s.row.user_id);
    if (!row) throw invalidCode();
    const digest = await this.checkCode(
        input.challenge,
        input.code,
        "verify_email",
        row,
      ),
      hash = await tokenHash(input.challenge),
      nonce = crypto.randomUUID(),
      n = this.now();
    let r: unknown[];
    try {
      r = await this.db.batch([
        this.claim(hash, digest, "verify_email", nonce, n, s),
        this.db
          .prepare(
            `UPDATE user_password_identities SET verified_email=?,email_verified_at_ms=?,pending_email=NULL,email_epoch=email_epoch+1,revision=revision+1,mutation_id=?,updated_at_ms=? WHERE user_id=? AND EXISTS(SELECT 1 FROM user_auth_tokens WHERE token_hash=? AND consumption_id=?)`,
          )
          .bind(row.email, n, nonce, n, row.user_id, hash, nonce),
        this.revokeTickets(row.user_id, nonce, n),
        this.auditGuard("email_verified", row.user_id, nonce),
      ]);
    } catch (e) {
      if (/UNIQUE constraint/i.test(String(e))) throw invalidCode();
      throw e;
    }
    if (!changed(r[0]) || !changed(r[1])) throw invalidCode();
    return {
      user: this.profile((await this.row(row.user_id))!),
      verified: true,
    };
  }
  async requestUnbind(request: Request) {
    const s = await this.require(request),
      email = s.row.verified_email || s.row.pending_email;
    if (!email) throw new ApiError("CONFLICT", "尚未绑定邮箱。");
    if (!this.mailer.available)
      throw new ApiError("SERVICE_UNAVAILABLE", "邮件暂时无法发送。", true);
    await this.mailLimit(email, s.row.user_id, "unbind");
    const c = await this.code("unbind_email"),
      n = this.now();
    const result = await this.db
      .prepare(
        "INSERT INTO user_auth_tokens(token_hash,code_hash,user_id,purpose,email,auth_version,email_epoch,created_at_ms,expires_at_ms) SELECT ?,?,i.user_id,'unbind_email',COALESCE(i.verified_email,i.pending_email),i.auth_version,i.email_epoch,?,? FROM user_password_identities i JOIN login_sessions s ON s.user_id=i.user_id JOIN users u ON u.id=i.user_id WHERE s.session_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.auth_version=i.auth_version AND u.status='active' AND u.role='user' AND i.email_epoch=? AND COALESCE(i.verified_email,i.pending_email)=?",
      )
      .bind(
        c.hash,
        c.digest,
        n,
        n + 600000,
        s.hash,
        new Date(n).toISOString(),
        s.row.email_epoch,
        email,
      )
      .run();
    if (!result.meta.changes)
      throw new ApiError("CONFLICT", "账号已更新，请重试。");
    await this.deliver(email, c, "unbind_email");
    return { challenge: c.challenge };
  }
  async unbindEmail(raw: unknown, request: Request) {
    const input = EmailUnbindSchema.parse(raw),
      s = await this.require(request),
      row = await this.ticket(input.challenge, "unbind_email", s.row.user_id);
    if (!row) throw invalidCode();
    const digest = await this.checkCode(
        input.challenge,
        input.code,
        "unbind_email",
        row,
      ),
      hash = await tokenHash(input.challenge),
      nonce = crypto.randomUUID(),
      n = this.now();
    const r = await this.db.batch([
      this.claim(hash, digest, "unbind_email", nonce, n, s),
      this.db
        .prepare(
          "UPDATE user_password_identities SET verified_email=NULL,email_verified_at_ms=NULL,pending_email=NULL,email_epoch=email_epoch+1,revision=revision+1,mutation_id=?,updated_at_ms=? WHERE user_id=? AND EXISTS(SELECT 1 FROM user_auth_tokens WHERE token_hash=? AND consumption_id=?)",
        )
        .bind(nonce, n, s.row.user_id, hash, nonce),
      this.revokeTickets(s.row.user_id, nonce, n),
      this.auditGuard("email_unbound", s.row.user_id, nonce),
    ]);
    if (!changed(r[0]) || !changed(r[1])) throw invalidCode();
    return this.profile((await this.row(s.row.user_id))!);
  }
  async requestReset(
    raw: unknown,
    ip: string,
    defer: (task: Promise<unknown>) => void,
  ) {
    const start = performance.now(),
      { email } = ResetRequestSchema.parse(raw);
    await this.limit("reset_request", ip, email);
    if (!this.mailer.available)
      throw new ApiError(
        "SERVICE_UNAVAILABLE",
        "邮件找回暂不可用，请稍后再试。",
        true,
      );
    await this.mailLimit(email, undefined, "reset");
    const c = await this.code("reset_password"),
      n = this.now();
    const r = await this.db
      .prepare(
        `INSERT INTO user_auth_tokens(token_hash,code_hash,user_id,purpose,email,auth_version,email_epoch,created_at_ms,expires_at_ms) SELECT ?,?,i.user_id,'reset_password',i.verified_email,i.auth_version,i.email_epoch,?,? FROM user_password_identities i JOIN users u ON u.id=i.user_id WHERE i.verified_email=? AND i.email_verified_at_ms IS NOT NULL AND u.status='active' AND u.role='user'`,
      )
      .bind(c.hash, c.digest, n, n + 600000, email)
      .run();
    if (r.meta.changes)
      defer(
        this.deliver(email, c, "reset_password").catch(() =>
          console.info(
            JSON.stringify({ event: "account.mail.failure", purpose: "reset" }),
          ),
        ),
      );
    if (performance.now() - start < 500)
      await new Promise((resolve) =>
        setTimeout(resolve, 500 - (performance.now() - start)),
      );
    return {
      message: "如果邮箱关联有效账号，我们将发送重置验证码。",
      challenge: c.challenge,
    };
  }
  async confirmReset(raw: unknown) {
    const input = ResetConfirmSchema.parse(raw),
      row = await this.ticket(input.challenge, "reset_password");
    if (!row) throw invalidCode();
    const digest = await this.checkCode(
      input.challenge,
      input.code,
      "reset_password",
      row,
    );
    const password = await this.passwords.hash(input.newPassword),
      hash = await tokenHash(input.challenge),
      nonce = crypto.randomUUID(),
      n = this.now();
    const r = await this.db.batch([
      this.claim(hash, digest, "reset_password", nonce, n),
      this.db
        .prepare(
          `UPDATE user_password_identities SET password_hash=?,auth_version=auth_version+1,email_epoch=email_epoch+1,revision=revision+1,mutation_id=?,updated_at_ms=? WHERE user_id=? AND EXISTS(SELECT 1 FROM user_auth_tokens WHERE token_hash=? AND consumption_id=?)`,
        )
        .bind(password, nonce, n, row.user_id, hash, nonce),
      this.db
        .prepare(
          "UPDATE login_sessions SET revoked_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM user_password_identities WHERE user_id=? AND mutation_id=?)",
        )
        .bind(new Date(n).toISOString(), row.user_id, row.user_id, nonce),
      this.revokeTickets(row.user_id, nonce, n),
      this.auditGuard("password_reset", row.user_id, nonce),
    ]);
    if (!changed(r[0]) || !changed(r[1])) throw invalidCode();
    return { reset: true };
  }
}
