"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  UsernameSchema,
  PasswordSchema,
  EmailSchema,
  OtpSchema,
  type AccountProfile,
} from "@/domain/account/contracts";
import { useAccount, accountRequest } from "./account-context";
import {
  AccountFrame,
  FormFeedback,
  useAccountAction,
  recoveryWarning,
} from "./shared";
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const register = mode === "register",
    account = useAccount(),
    router = useRouter(),
    action = useAccountAction();
  const [identifier, setIdentifier] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [email, setEmail] = useState("");
  const submit = () =>
    action.run(
      async () => {
        if (register && !UsernameSchema.safeParse(identifier).success)
          throw Error(
            "用户名需3–24位英文字母、数字或下划线，且不能使用系统保留名称。",
          );
        if (register && !PasswordSchema.safeParse(password).success)
          throw Error("密码需8–256个字符。");
        if (register && password !== confirm)
          throw Error("两次输入的密码不一致。");
        if (register && email && !EmailSchema.safeParse(email).success)
          throw Error("请输入有效邮箱地址。");
        const data = await accountRequest<{
          user: AccountProfile;
          emailChallenge?: string | null;
        }>(
          "/api/auth/" + mode,
          register
            ? { username: identifier, password, ...(email ? { email } : {}) }
            : { identifier, password },
        );
        setPassword("");
        setConfirm("");
        await account.changed("identity");
        if (data.emailChallenge && data.user.pendingEmail)
          account.setChallenge({
            userId: data.user.id,
            email: data.user.pendingEmail,
            id: data.emailChallenge,
          });
        router.replace("/account");
      },
      register ? "注册成功" : "登录成功",
    );
  return (
    <AccountFrame title={register ? "注册账号" : "登录账号"}>
      <div className="account-entry account-card">
        {account.error && (
          <p className="account-error" role="alert">
            {account.error}
            <button type="button" onClick={() => void account.refresh()}>
              重试
            </button>
          </p>
        )}
        {account.session && !account.session.available && (
          <p role="status">账号服务暂不可用，请稍后重试。</p>
        )}
        <form
          aria-label={register ? "注册账号" : "登录账号"}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label>
            {register ? "用户名" : "用户名或邮箱"}
            <input
              aria-label={register ? "用户名" : "用户名或邮箱"}
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              maxLength={register ? 24 : 254}
              required
              placeholder={
                register ? "3–24位字母、数字或下划线" : "用户名或已验证邮箱"
              }
            />
          </label>
          <label>
            密码
            <input
              aria-label="密码"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={256}
              required
            />
          </label>
          {register && (
            <>
              <label>
                确认密码
                <input
                  aria-label="确认密码"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  maxLength={256}
                  required
                />
              </label>
              <label>
                邮箱（可选）
                <input
                  aria-label="邮箱（可选）"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                />
              </label>
              <p className="account-note">{recoveryWarning}</p>
              {account.session && !account.session.mailAvailable && (
                <p className="account-note">
                  邮箱验证暂未开通，可先使用用户名注册和登录。
                </p>
              )}
            </>
          )}
          <FormFeedback error={action.error} success={action.success} />
          <button
            className="account-primary"
            disabled={
              action.busy || account.loading || !account.session?.available
            }
            type="submit"
          >
            {action.busy ? "正在提交…" : register ? "注册并登录" : "登录"}
          </button>
        </form>
        <div className="account-links">
          <Link href={register ? "/account/login" : "/account/register"}>
            {register ? "已有账号，去登录" : "注册账号"}
          </Link>
          {!register && <Link href="/account/forgot-password">忘记密码</Link>}
          <Link href="/map">游客浏览</Link>
        </div>
      </div>
    </AccountFrame>
  );
}
export function ForgotPassword() {
  const account = useAccount(),
    action = useAccountAction(),
    [email, setEmail] = useState(""),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [done, setDone] = useState(false);
  const send = () =>
    action.run(async () => {
      if (!EmailSchema.safeParse(email).success)
        throw Error("请输入有效邮箱地址。");
      const r = await accountRequest<{ challenge: string }>(
        "/api/auth/password/reset/request",
        { email },
      );
      setChallenge(r.challenge);
      setCode("");
    }, "如果邮箱关联有效账号，我们将发送重置验证码。");
  const reset = () =>
    action.run(async () => {
      if (!OtpSchema.safeParse(code).success)
        throw Error("请输入6位邮箱验证码。");
      if (!PasswordSchema.safeParse(password).success)
        throw Error("密码需8–256个字符。");
      if (password !== confirm) throw Error("两次输入的新密码不一致。");
      await accountRequest("/api/auth/password/reset/confirm", {
        challenge,
        code,
        newPassword: password,
      });
      setCode("");
      setPassword("");
      setConfirm("");
      setChallenge("");
      setDone(true);
      await account.changed("identity");
    }, "密码已重置，请使用新密码登录。");
  return (
    <AccountFrame title="找回密码">
      <div className="account-entry account-card">
        <p className="account-note">
          仅已验证的绑定邮箱可以找回密码。{recoveryWarning}
        </p>
        {account.session && !account.session.mailAvailable && (
          <p role="status">邮件找回暂不可用，请稍后再试。</p>
        )}
        {!done && (
          <>
            <form
              aria-label="发送重置验证码"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label>
                已验证邮箱
                <input
                  aria-label="已验证邮箱"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setChallenge("");
                  }}
                  maxLength={254}
                />
              </label>
              <button
                type="submit"
                disabled={action.busy || !account.session?.mailAvailable}
              >
                发送验证码
              </button>
            </form>
            {challenge && (
              <form
                aria-label="重置密码"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void reset();
                }}
              >
                <label>
                  邮箱验证码
                  <input
                    className="account-code"
                    aria-label="邮箱验证码"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    maxLength={6}
                  />
                </label>
                <p className="account-note">
                  6位验证码，10分钟内有效，仅可使用一次。
                </p>
                <label>
                  新密码
                  <input
                    aria-label="新密码"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    maxLength={256}
                  />
                </label>
                <label>
                  确认新密码
                  <input
                    aria-label="确认新密码"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    maxLength={256}
                  />
                </label>
                <button
                  className="account-primary"
                  type="submit"
                  disabled={action.busy}
                >
                  重置密码
                </button>
              </form>
            )}
          </>
        )}
        <FormFeedback error={action.error} success={action.success} />
        <div className="account-links">
          <Link href="/account/login">返回登录</Link>
        </div>
      </div>
    </AccountFrame>
  );
}
