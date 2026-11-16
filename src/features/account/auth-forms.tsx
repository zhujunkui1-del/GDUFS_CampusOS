"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { ChevronRight, UserRound } from "lucide-react";
import {
  UsernameSchema,
  PasswordSchema,
  EmailSchema,
  OtpSchema,
  type EmailLoginChoice,
} from "@/domain/account/contracts";
import { useAccount, accountRequest } from "./account-context";
import { useEmailCodeAction } from "./use-email-code-action";
import { AccountFrame, FormFeedback, useAccountAction } from "./shared";
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const register = mode === "register",
    account = useAccount(),
    router = useRouter(),
    action = useAccountAction(),
    send = useEmailCodeAction("registration");
  const [identifier, setIdentifier] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [email, setEmail] = useState(""),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState(""),
    [choice, setChoice] = useState<EmailLoginChoice | null>(null);
  async function signedIn() {
    await account.changed("identity");
    router.replace("/account");
  }
  const clearCode = () => {
    setChallenge("");
    setCode("");
  };
  const submit = () =>
    action.run(
      async () => {
        if (register && !UsernameSchema.safeParse(identifier).success)
          throw Error("请输入3–24位字母、数字或下划线。");
        if (register && !PasswordSchema.safeParse(password).success)
          throw Error("密码至少8位。");
        if (register && password !== confirm) throw Error("两次密码不一致。");
        if (register && email && !EmailSchema.safeParse(email).success)
          throw Error("请输入有效邮箱。");
        if (
          register &&
          email &&
          (!challenge || !OtpSchema.safeParse(code).success)
        )
          throw Error("请输入邮箱验证码。");
        const result = await accountRequest<
          EmailLoginChoice | { user: unknown }
        >(
          "/api/auth/" + mode,
          register
            ? {
                username: identifier,
                password,
                ...(email ? { email, challenge, code } : {}),
              }
            : {
                identifier,
                password,
                ...(identifier.includes("@") ? { selectAccount: true } : {}),
              },
        );
        setPassword("");
        setConfirm("");
        setCode("");
        if ("choiceToken" in result) setChoice(result);
        else await signedIn();
      },
      register ? "注册成功" : "",
    );
  return (
    <AccountFrame title={register ? "注册账号" : "登录"} backHref="/account">
      <div className="account-entry account-card">
        {account.error && (
          <p role="alert" className="account-error">
            {account.error}
            <button type="button" onClick={() => void account.refresh()}>
              重试
            </button>
          </p>
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
              onChange={(e) => {
                setIdentifier(e.target.value);
                clearCode();
              }}
              maxLength={register ? 24 : 254}
              required
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
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearCode();
                  }}
                  maxLength={254}
                />
              </label>
              {email && (
                <label>
                  验证码
                  <span className="account-code-row">
                    <input
                      aria-label="邮箱验证码"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      maxLength={6}
                    />
                    <button
                      type="button"
                      disabled={
                        send.busy ||
                        send.coolingDown ||
                        action.busy ||
                        !account.session?.mailAvailable
                      }
                      onClick={() =>
                        void send.run(async () => {
                          if (!UsernameSchema.safeParse(identifier).success)
                            throw Error("请输入有效用户名。");
                          if (!EmailSchema.safeParse(email).success)
                            throw Error("请输入有效邮箱。");
                          const r = await accountRequest<{ challenge: string }>(
                            "/api/auth/register/email-code",
                            { username: identifier, email },
                          );
                          setChallenge(r.challenge);
                        }, "已发送")
                      }
                    >
                      {send.label}
                    </button>
                  </span>
                </label>
              )}
            </>
          )}
          <FormFeedback
            error={action.error || send.error}
            success={send.success}
          />
          <button
            className="account-primary"
            disabled={
              action.busy ||
              send.busy ||
              account.loading ||
              !account.session?.available
            }
          >
            {action.busy ? "正在提交…" : register ? "注册并登录" : "登录"}
          </button>
        </form>
        <div
          className={`account-links account-auth-links${register ? " account-auth-links-single" : ""}`}
        >
          <Link href={register ? "/account/login" : "/account/register"}>
            {register ? "去登录" : "注册账号"}
          </Link>
          {!register && <Link href="/account/forgot-password">找回密码</Link>}
        </div>
      </div>
      {choice && (
        <EmailAccountPicker
          choice={choice}
          onClose={() => setChoice(null)}
          onSelect={signedIn}
        />
      )}
    </AccountFrame>
  );
}
function EmailAccountPicker({
  choice,
  onClose,
  onSelect,
}: {
  choice: EmailLoginChoice;
  onClose(): void;
  onSelect(): Promise<void>;
}) {
  const choiceAction = useAccountAction();
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !choiceAction.busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="conversation-confirm-backdrop" />
        <Dialog.Popup className="conversation-confirm account-choice">
          <Dialog.Title>选择登录账号</Dialog.Title>
          <div className="account-group account-choice-list">
            {choice.accounts.map((username, index) => (
              <button
                type="button"
                className="account-row"
                key={username}
                disabled={choiceAction.busy}
                onClick={() =>
                  void choiceAction.run(async () => {
                    await accountRequest("/api/auth/login/select", {
                      choiceToken: choice.choiceToken,
                      index,
                    });
                    await onSelect();
                    onClose();
                  }, "")
                }
              >
                <span className="account-row-icon">
                  <UserRound size={21} strokeWidth={1.8} />
                </span>
                <span className="account-row-label">{username}</span>
                <ChevronRight className="account-row-chevron" size={18} />
              </button>
            ))}
          </div>
          <FormFeedback error={choiceAction.error} success="" />
          <div className="conversation-confirm-actions">
            <Dialog.Close disabled={choiceAction.busy}>取消</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ForgotPassword({
  backHref = "/account/login",
}: {
  backHref?: string;
}) {
  const account = useAccount(),
    action = useAccountAction(),
    send = useEmailCodeAction("reset"),
    [email, setEmail] = useState(account.session?.user?.email || ""),
    [username, setUsername] = useState(account.session?.user?.username || ""),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [done, setDone] = useState(false);
  if (account.session?.user && !account.session.user.email && !done)
    return (
      <AccountFrame title="找回密码" backHref={backHref}>
        <div className="account-entry account-card">
          <Link className="account-primary-link" href="/account/settings/email">
            绑定邮箱
          </Link>
        </div>
      </AccountFrame>
    );
  return (
    <AccountFrame title="找回密码" backHref={backHref}>
      <div className="account-entry account-card">
        {done ? (
          <div className="account-links">
            <p role="status">密码已重置</p>
            <Link href="/account/login">去登录</Link>
          </div>
        ) : (
          <form
            aria-label="重置密码"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                if (!challenge || !OtpSchema.safeParse(code).success)
                  throw Error("请输入6位验证码。");
                if (!PasswordSchema.safeParse(password).success)
                  throw Error("密码至少8位。");
                if (password !== confirm) throw Error("两次密码不一致。");
                await accountRequest("/api/auth/password/reset/confirm", {
                  challenge,
                  code,
                  newPassword: password,
                });
                setCode("");
                setPassword("");
                setConfirm("");
                setDone(true);
                await account.changed("identity");
              }, "密码已重置");
            }}
          >
            <label>
              用户名（共用邮箱时必填）
              <input
                autoComplete="username"
                value={username}
                disabled={send.busy}
                maxLength={24}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setChallenge("");
                  setCode("");
                }}
              />
            </label>
            <label>
              邮箱
              <input
                aria-label="邮箱"
                type="email"
                autoComplete="email"
                value={email}
                disabled={send.busy}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setChallenge("");
                  setCode("");
                }}
                maxLength={254}
              />
            </label>
            <label>
              验证码
              <span className="account-code-row">
                <input
                  aria-label="邮箱验证码"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={6}
                />
                <button
                  type="button"
                  disabled={
                    send.busy ||
                    send.coolingDown ||
                    !account.session?.mailAvailable
                  }
                  onClick={() =>
                    void send.run(async () => {
                      if (!EmailSchema.safeParse(email).success)
                        throw Error("请输入有效邮箱。");
                      const name = username.trim();
                      if (name && !UsernameSchema.safeParse(name).success)
                        throw Error("请输入有效用户名。");
                      const r = await accountRequest<{ challenge: string }>(
                        "/api/auth/password/reset/request",
                        { email, ...(name ? { username: name } : {}) },
                      );
                      setChallenge(r.challenge);
                    }, "已申请发送")
                  }
                >
                  {send.label}
                </button>
              </span>
            </label>
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
              确认密码
              <input
                aria-label="确认新密码"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                maxLength={256}
              />
            </label>
            <FormFeedback
              error={send.error || action.error}
              success={send.success}
            />
            <button
              className="account-primary"
              disabled={action.busy || account.loading}
            >
              重置密码
            </button>
          </form>
        )}
      </div>
    </AccountFrame>
  );
}
