"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Settings,
  Bookmark,
  CodeXml,
  UserRound,
  LockKeyhole,
  KeyRound,
  Mail,
  ChevronRight,
  LogOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  UsernameSchema,
  PasswordSchema,
  EmailSchema,
  OtpSchema,
  type AccountProfile,
} from "@/domain/account/contracts";
import { useAccount, accountRequest } from "./account-context";
import { useEmailCodeAction } from "./use-email-code-action";
import { AccountFrame, FormFeedback, useAccountAction } from "./shared";
import { ApiSettingsView } from "./api-settings-view";

type View =
  | "home"
  | "settings"
  | "username"
  | "password"
  | "email"
  | "unbind"
  | "api";
export function AccountPageView({ view = "home" }: { view?: View }) {
  const account = useAccount(),
    user = account.session?.user;
  const titles = {
    home: "我的",
    settings: "设置",
    username: "修改用户名",
    password: "修改密码",
    email: "邮箱",
    unbind: "解绑邮箱",
    api: "API 设置",
  };
  const back =
    view === "home"
      ? undefined
      : view === "settings"
        ? "/account"
        : view === "unbind"
          ? "/account/settings/email"
          : "/account/settings";
  return (
    <AccountFrame title={titles[view]} backHref={back} home={view === "home"}>
      {account.error && (
        <p role="alert" className="account-error">
          {account.error}
          <button type="button" onClick={() => void account.refresh()}>
            重试
          </button>
        </p>
      )}
      {!account.session && account.loading && <p role="status">正在载入…</p>}
      {account.session && !user &&
        (view === "api" ? (
          <ApiSettingsView />
        ) : (
          <div className="account-card account-entry">
            <h2>游客</h2>
            <div className="account-links">
              <Link className="account-primary-link" href="/account/login">
                登录
              </Link>
              <Link href="/account/register">注册</Link>
            </div>
          </div>
        ))}
      {user && <AccountContent key={user.id + view} user={user} view={view} />}
    </AccountFrame>
  );
}
function Row({
  icon: Icon,
  label,
  href,
  value,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  value?: string;
  disabled?: boolean;
}) {
  const children = (
    <>
      <span className="account-row-icon">
        <Icon size={21} strokeWidth={1.8} />
      </span>
      <span className="account-row-label">{label}</span>
      {value && <span className="account-row-value">{value}</span>}
      {href && <ChevronRight className="account-row-chevron" size={18} />}
    </>
  );
  return href ? (
    <Link className="account-row" href={href}>
      {children}
    </Link>
  ) : (
    <button className="account-row" type="button" disabled={disabled}>
      {children}
    </button>
  );
}
function AccountContent({ user, view }: { user: AccountProfile; view: View }) {
  if (view === "home")
    return (
      <div className="account-home-layout">
        <section className="account-card account-overview">
          <div className="account-monogram" aria-hidden="true">
            {user.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h2>{user.username}</h2>
            <p className="account-private-email">
              email: {user.email || user.pendingEmail || "未绑定"}
            </p>
          </div>
        </section>
        <div className="account-home-links">
          <div className="account-card account-group">
            <Row icon={Settings} label="设置" href="/account/settings" />
          </div>
          <div className="account-card account-group">
            <Row
              icon={Bookmark}
              label="收藏"
              href="/account/favorites"
            />
            <Row
              icon={CodeXml}
              label="API 设置"
              href="/account/settings/api"
            />
          </div>
        </div>
      </div>
    );
  if (view === "api") return <ApiSettingsView />;
  if (view === "settings") return <SettingsPage user={user} />;
  return (
    <div className="account-form-layout">
      <section className="account-card account-form-card">
        {view === "username" ? (
          <RenameForm user={user} />
        ) : view === "password" ? (
          <PasswordForm />
        ) : view === "email" ? (
          <EmailPage user={user} />
        ) : (
          <UnbindPage user={user} />
        )}
      </section>
    </div>
  );
}
function SettingsPage({ user }: { user: AccountProfile }) {
  const account = useAccount(),
    action = useAccountAction();
  return (
    <div className="account-settings-layout">
      <section>
        <h2 className="account-group-label">账号管理</h2>
        <div className="account-card account-group">
          <Row
            icon={UserRound}
            label="修改用户名"
            href="/account/settings/username"
          />
          <Row
            icon={LockKeyhole}
            label="修改密码"
            href="/account/settings/password"
          />
          <Row
            icon={KeyRound}
            label="找回密码"
            href="/account/settings/recovery"
          />
        </div>
      </section>
      <section>
        <h2 className="account-group-label">账户信息</h2>
        <div className="account-card account-group">
          <Row
            icon={CodeXml}
            label="API 设置"
            href="/account/settings/api"
          />
          <Row
            icon={Mail}
            label="邮箱"
            value={user.email || user.pendingEmail || "未绑定"}
            href="/account/settings/email"
          />
        </div>
        <button
          className="account-danger account-logout"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await accountRequest("/api/auth/logout", {});
              await account.changed("identity");
            }, "已退出")
          }
        >
          <LogOut size={19} />
          退出登录
        </button>
        <FormFeedback error={action.error} success={action.success} />
      </section>
    </div>
  );
}
function RenameForm({ user }: { user: AccountProfile }) {
  const account = useAccount(),
    router = useRouter(),
    action = useAccountAction(),
    [username, setUsername] = useState(user.username);
  return (
    <form
      aria-label="修改用户名"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          if (!UsernameSchema.safeParse(username).success)
            throw Error("请输入3–24位字母、数字或下划线。");
          await accountRequest("/api/me", { username }, "PATCH");
          await account.changed();
          router.push("/account");
        }, "已保存");
      }}
    >
      <label>
        用户名
        <input
          aria-label="新用户名"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={24}
        />
      </label>
      <FormFeedback error={action.error} success={action.success} />
      <button
        className="account-primary"
        disabled={action.busy || account.loading}
      >
        保存
      </button>
    </form>
  );
}
function PasswordForm() {
  const account = useAccount(),
    action = useAccountAction(),
    [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  return (
    <form
      aria-label="修改密码"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          if (!PasswordSchema.safeParse(password).success)
            throw Error("密码至少8位。");
          if (password !== confirm) throw Error("两次密码不一致。");
          await accountRequest("/api/auth/password/change", {
            currentPassword: current,
            newPassword: password,
          });
          setCurrent("");
          setPassword("");
          setConfirm("");
          await account.changed();
        }, "密码已修改");
      }}
    >
      <label>
        当前密码
        <input
          aria-label="当前密码"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          maxLength={256}
        />
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
      <FormFeedback error={action.error} success={action.success} />
      <button
        className="account-primary"
        disabled={action.busy || account.loading}
      >
        保存
      </button>
    </form>
  );
}
function EmailPage({ user }: { user: AccountProfile }) {
  const account = useAccount(),
    send = useEmailCodeAction("bind"),
    verify = useAccountAction(),
    [email, setEmail] = useState(user.pendingEmail || ""),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState("");
  if (user.email)
    return (
      <div className="account-email-bound">
        <Mail size={24} />
        <p className="account-private-email">{user.email}</p>
        <Link className="account-danger" href="/account/settings/email/unbind">
          解绑邮箱
        </Link>
      </div>
    );
  return (
    <form
      aria-label="绑定邮箱"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void verify.run(async () => {
          if (!challenge || !OtpSchema.safeParse(code).success)
            throw Error("请输入6位验证码。");
          await accountRequest("/api/auth/email/verify", { challenge, code });
          await account.changed();
        }, "已绑定");
      }}
    >
      <label>
        邮箱
        <input
          aria-label="邮箱地址"
          type="email"
          autoComplete="email"
          value={email}
          maxLength={254}
          onChange={(e) => {
            setEmail(e.target.value);
            setChallenge("");
            setCode("");
          }}
        />
      </label>
      <label>
        验证码
        <span className="account-code-row">
          <input
            aria-label="邮箱验证码"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            type="button"
            disabled={
              send.busy || send.coolingDown || !account.session?.mailAvailable
            }
            onClick={() =>
              void send.run(async () => {
                if (!EmailSchema.safeParse(email).success)
                  throw Error("请输入有效邮箱。");
                const r = await accountRequest<{ challenge: string }>(
                  "/api/auth/email/bind",
                  { email },
                );
                setChallenge(r.challenge);
              }, "已发送")
            }
          >
            {send.label}
          </button>
        </span>
      </label>
      <FormFeedback
        error={send.error || verify.error}
        success={send.success || verify.success}
      />
      <button
        className="account-primary"
        disabled={
          verify.busy || account.loading || !account.session?.mailAvailable
        }
      >
        绑定邮箱
      </button>
      {user.pendingEmail && (
        <Link className="account-danger" href="/account/settings/email/unbind">
          解绑邮箱
        </Link>
      )}
    </form>
  );
}
function UnbindPage({ user }: { user: AccountProfile }) {
  const account = useAccount(),
    router = useRouter(),
    send = useEmailCodeAction("unbind"),
    action = useAccountAction(),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState("");
  if (!user.email && !user.pendingEmail) return <p>未绑定邮箱</p>;
  return (
    <form
      aria-label="解绑邮箱"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          if (!challenge || !OtpSchema.safeParse(code).success)
            throw Error("请输入6位验证码。");
          await accountRequest("/api/auth/email/unbind", { challenge, code });
          await account.changed();
          router.replace("/account/settings/email");
        }, "已解绑");
      }}
    >
      <p className="account-private-email account-email-target">
        {user.email || user.pendingEmail}
      </p>
      <label>
        验证码
        <span className="account-code-row">
          <input
            aria-label="邮箱验证码"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            type="button"
            disabled={
              send.busy || send.coolingDown || !account.session?.mailAvailable
            }
            onClick={() =>
              void send.run(async () => {
                const r = await accountRequest<{ challenge: string }>(
                  "/api/auth/email/unbind/request",
                  {},
                );
                setChallenge(r.challenge);
              }, "已发送")
            }
          >
            {send.label}
          </button>
        </span>
      </label>
      <FormFeedback
        error={send.error || action.error}
        success={send.success || action.success}
      />
      <button
        className="account-danger"
        disabled={
          action.busy || account.loading || !account.session?.mailAvailable
        }
      >
        解绑邮箱
      </button>
    </form>
  );
}
