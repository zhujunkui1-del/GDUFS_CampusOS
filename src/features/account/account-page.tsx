"use client";
import Link from "next/link";
import { useState } from "react";
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
export function AccountPageView() {
  const account = useAccount(),
    logout = useAccountAction(),
    user = account.session?.user;
  return (
    <AccountFrame title="我的账号">
      {account.error && (
        <p role="alert" className="account-error">
          {account.error}{" "}
          <button type="button" onClick={() => void account.refresh()}>
            重试
          </button>
        </p>
      )}
      {account.loading && !account.session && (
        <p role="status">正在读取账号状态…</p>
      )}
      {account.session && !user && (
        <div className="account-card account-entry">
          <h2>游客模式</h2>
          <p>校园地图、雷达、知识、活动日历和校园助理均可继续使用。</p>
          {account.session.available ? (
            <div className="account-links">
              <Link className="account-primary-link" href="/account/login">
                登录账号
              </Link>
              <Link href="/account/register">注册账号</Link>
            </div>
          ) : (
            <p role="status">账号服务暂不可用，请稍后重试。</p>
          )}
        </div>
      )}
      {user && (
        <>
          <AccountDetails key={user.id} user={user} />
          <div className="account-logout">
            <button
              disabled={logout.busy}
              onClick={() =>
                void logout.run(async () => {
                  await accountRequest("/api/auth/logout", {});
                  await account.changed("identity");
                }, "已退出登录")
              }
            >
              退出登录
            </button>
            <FormFeedback error={logout.error} success={logout.success} />
          </div>
        </>
      )}
    </AccountFrame>
  );
}
function AccountDetails({ user }: { user: AccountProfile }) {
  return (
    <>
      <div className="account-card account-overview">
        <div className="account-monogram" aria-hidden="true">
          {user.username.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h2>{user.username}</h2>
          <p>
            注册于{" "}
            {new Intl.DateTimeFormat("zh-CN", {
              timeZone: "Asia/Shanghai",
              dateStyle: "medium",
            }).format(new Date(user.createdAt))}
          </p>
          <p>当前已登录</p>
        </div>
      </div>
      <div className="account-grid">
        <RenameForm user={user} />
        <PasswordForm />
        <EmailForms user={user} />
        <section className="account-card">
          <h2>账号设置</h2>
          <ul className="account-future">
            <li>
              <span>个人收藏</span>
              <small>后续开放</small>
            </li>
            <li>
              <span>AI 会话同步</span>
              <small>后续开放</small>
            </li>
            <li>
              <span>个性化偏好</span>
              <small>后续开放</small>
            </li>
            <li>
              <span>模型 API 设置</span>
              <small>后续开放</small>
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
function RenameForm({ user }: { user: AccountProfile }) {
  const account = useAccount(),
    action = useAccountAction(),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [observedAt] = useState(() => Date.now());
  const cooldown = user.usernameChangeAvailableAt > observedAt;
  return (
    <section className="account-card">
      <h2>修改用户名</h2>
      <p className="account-note">
        当前用户名：{user.username}。用户名每24小时可修改一次。
      </p>
      <form
        aria-label="修改用户名"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            if (!UsernameSchema.safeParse(username).success)
              throw Error(
                "用户名需3–24位字母、数字或下划线，且不能使用系统保留名称。",
              );
            await accountRequest(
              "/api/me",
              { username, currentPassword: password },
              "PATCH",
            );
            setPassword("");
            setUsername("");
            await account.changed();
          }, "用户名已修改");
        }}
      >
        <label>
          新用户名
          <input
            aria-label="新用户名"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={24}
          />
        </label>
        <label>
          当前密码
          <input
            aria-label="当前密码（修改用户名）"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={256}
          />
        </label>
        <FormFeedback error={action.error} success={action.success} />
        <button
          type="submit"
          disabled={
            action.busy || account.loading || !!account.error || cooldown
          }
        >
          保存用户名
        </button>
      </form>
    </section>
  );
}
function PasswordForm() {
  const account = useAccount(),
    action = useAccountAction(),
    [old, setOld] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  return (
    <section className="account-card">
      <h2>修改密码</h2>
      <p className="account-note">修改后，其他设备需重新登录。</p>
      <form
        aria-label="修改密码"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            if (!PasswordSchema.safeParse(password).success)
              throw Error("密码需8–256个字符。");
            if (password !== confirm) throw Error("两次输入的新密码不一致。");
            await accountRequest("/api/auth/password/change", {
              currentPassword: old,
              newPassword: password,
            });
            setOld("");
            setPassword("");
            setConfirm("");
            await account.changed();
          }, "密码已修改，旧登录会话已撤销");
        }}
      >
        <label>
          当前密码
          <input
            aria-label="当前密码（修改密码）"
            type="password"
            autoComplete="current-password"
            value={old}
            onChange={(e) => setOld(e.target.value)}
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
        <FormFeedback error={action.error} success={action.success} />
        <button
          type="submit"
          disabled={action.busy || account.loading || !!account.error}
        >
          保存新密码
        </button>
      </form>
    </section>
  );
}
function EmailForms({ user }: { user: AccountProfile }) {
  const account = useAccount(),
    send = useAccountAction(),
    verify = useAccountAction(),
    unbind = useAccountAction();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [unbindPassword, setUnbindPassword] = useState("");
  const available = !!account.session?.mailAvailable,
    challenge =
      account.challenge?.userId === user.id ? account.challenge : null;
  return (
    <section className="account-card">
      <h2>邮箱与找回密码</h2>
      <FormFeedback error={unbind.error} success={unbind.success} />
      <FormFeedback error={verify.error} success={verify.success} />
      <dl className="account-email-status">
        <dt>已验证邮箱</dt>
        <dd className="account-private-email">{user.email || "未绑定"}</dd>
        {user.pendingEmail && (
          <>
            <dt>待验证邮箱</dt>
            <dd className="account-private-email">{user.pendingEmail}</dd>
          </>
        )}
      </dl>
      {!user.email && (
        <p className="account-note account-risk">{recoveryWarning}</p>
      )}
      {!available && (
        <p role="status" className="account-note">
          邮箱验证暂未开通，可继续使用用户名和密码。
        </p>
      )}
      <form
        aria-label="绑定或更换邮箱"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void send.run(async () => {
            const target = email || user.pendingEmail || "";
            if (!EmailSchema.safeParse(target).success)
              throw Error("请输入有效邮箱地址。");
            const r = await accountRequest<{
              user: AccountProfile;
              challenge: string;
            }>(user.email ? "/api/auth/email/change" : "/api/auth/email/bind", {
              email: target,
              currentPassword: password,
            });
            setPassword("");
            setCode("");
            await account.changed();
            account.setChallenge({
              userId: user.id,
              email: target,
              id: r.challenge,
            });
          }, "验证码已发送，请在10分钟内完成验证");
        }}
      >
        <label>
          {user.email ? "新邮箱" : "邮箱地址"}
          <input
            aria-label="邮箱地址"
            type="email"
            autoComplete="email"
            placeholder={user.pendingEmail || "name@example.com"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            disabled={!available}
          />
        </label>
        <label>
          当前密码
          <input
            aria-label="当前密码（邮箱设置）"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={256}
            disabled={!available}
          />
        </label>
        <FormFeedback error={send.error} success={send.success} />
        <button
          type="submit"
          disabled={
            !available || send.busy || account.loading || !!account.error
          }
        >
          发送邮箱验证码
        </button>
      </form>
      {challenge && (
        <form
          aria-label="验证绑定邮箱"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void verify.run(async () => {
              if (!OtpSchema.safeParse(code).success)
                throw Error("请输入6位邮箱验证码。");
              await accountRequest("/api/auth/email/verify", {
                challenge: challenge.id,
                code,
              });
              setCode("");
              account.setChallenge(null);
              await account.changed();
            }, "邮箱已验证，可用于登录和找回密码");
          }}
        >
          <p className="account-note">
            验证码已申请发送至{" "}
            <span className="account-private-email">{challenge.email}</span>
            ，10分钟有效，最多尝试5次。
          </p>
          <label>
            邮箱验证码
            <input
              className="account-code"
              aria-label="邮箱验证码"
              autoComplete="one-time-code"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
            />
          </label>
          <button
            className="account-primary"
            type="submit"
            disabled={!available || verify.busy || account.loading}
          >
            验证邮箱
          </button>
        </form>
      )}
      {(user.email || user.pendingEmail) && (
        <form
          className="account-unbind"
          aria-label="解除邮箱绑定"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void unbind.run(async () => {
              await accountRequest("/api/auth/email/unbind", {
                currentPassword: unbindPassword,
              });
              setUnbindPassword("");
              account.setChallenge(null);
              await account.changed();
            }, "邮箱已解除绑定");
          }}
        >
          <h3>{user.email ? "解除邮箱绑定" : "取消待验证邮箱"}</h3>
          <p className="account-note">
            解除邮箱绑定后，你将无法使用邮箱登录或找回密码，请确保记住用户名和密码。
          </p>
          <label>
            当前密码
            <input
              aria-label="当前密码（解除邮箱绑定）"
              type="password"
              autoComplete="current-password"
              value={unbindPassword}
              onChange={(e) => setUnbindPassword(e.target.value)}
              maxLength={256}
            />
          </label>
          <button
            type="submit"
            disabled={unbind.busy || account.loading || !!account.error}
          >
            {user.email ? "解除邮箱绑定" : "取消待验证邮箱"}
          </button>
        </form>
      )}
    </section>
  );
}
