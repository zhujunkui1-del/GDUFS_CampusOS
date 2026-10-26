"use client";
import { useEffect, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Eye,
  RefreshCw,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import type { SourceSession, TrafficSummary } from "@/domain/console/dashboard";

type Client = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
const number = (v: number) => v.toLocaleString("zh-CN");
const time = (v: number) =>
  new Date(v).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
const failure = (e: unknown) =>
  e instanceof Error ? e.message : "暂时无法获取，请重试。";

export function TrafficPanel({
  request,
  revision,
}: {
  request: Client;
  revision: number;
}) {
  const [data, setData] = useState<TrafficSummary | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [range, setRange] = useState<7 | 30>(7);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let active = true;
    request<TrafficSummary>("v2/traffic")
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(failure(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [request, refresh, revision]);
  const days = data?.days.slice(-range) ?? [],
    max = Math.max(1, ...days.map((d) => d.views ?? 0));
  const metrics = data
    ? [
        { label: "今日访问量", value: data.today, Icon: CalendarDays },
        { label: "近7天", value: data.last7, Icon: Eye },
        { label: "近30天", value: data.last30, Icon: BarChart3 },
        { label: "累计访问量", value: data.total, Icon: BarChart3 },
      ]
    : [];
  return (
    <section
      className="console-card console-traffic"
      aria-labelledby="traffic-title"
    >
      <div className="console-panel-heading">
        <h2 id="traffic-title">
          <BarChart3 size={22} />
          访问量
        </h2>
        <button
          aria-label="刷新访问量"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setRefresh((v) => v + 1);
          }}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {error && (
        <p role="status" className="console-feedback">
          {error}
        </p>
      )}
      {!data ? (
        <p className="console-empty">{busy ? "正在读取访问量…" : "暂无统计"}</p>
      ) : (
        <>
          <div className="console-traffic-metrics">
            {metrics.map(({ label, value, Icon }) => (
              <article key={label}>
                <span>
                  <Icon size={18} />
                  {label}
                </span>
                <strong>{number(value)}</strong>
              </article>
            ))}
          </div>
          <div className="console-traffic-toolbar">
            <h3>近{range}天访问趋势</h3>
            <div aria-label="访问趋势范围">
              {([7, 30] as const).map((n) => (
                <button
                  key={n}
                  aria-pressed={range === n}
                  onClick={() => setRange(n)}
                >
                  {n}天
                </button>
              ))}
            </div>
          </div>
          <div
            className="console-traffic-chart"
            role="figure"
            aria-label={`近${range}天页面访问量`}
          >
            <ul
              style={{
                gridTemplateColumns: `repeat(${range},minmax(${range === 7 ? "0" : "36px"},1fr))`,
                gap: range === 7 ? "6px" : "10px",
              }}
            >
              {days.map((d) => (
                <li
                  key={d.day}
                  title={`${d.day}：${d.views === null ? "未统计" : number(d.views) + "次"}`}
                >
                  <span>{d.views === null ? "—" : number(d.views)}</span>
                  <div className="console-traffic-bar-space">
                    {d.views !== null && (
                      <div
                        className="console-traffic-bar"
                        style={{
                          height: d.views
                            ? `${Math.max(4, (d.views / max) * 130)}px`
                            : "2px",
                        }}
                      />
                    )}
                  </div>
                  <time dateTime={d.day}>
                    {d.day.slice(5).replace("-", "/")}
                  </time>
                </li>
              ))}
            </ul>
          </div>
          <p className="console-traffic-note">
            页面浏览量（PV），北京时间；自 {time(data.startedAt)}{" "}
            起记录，之前未统计。
          </p>
        </>
      )}
    </section>
  );
}
type SessionView = Omit<SourceSession, "checkedAt"> & {
  checkedAt: number | null;
  reason?: string;
};
const names: Record<SourceSession["state"], string> = {
  logged_in: "已登录",
  login_required: "需要重新登录",
  verification_required: "需要安全验证",
  unknown: "状态未确认",
  unavailable: "暂时无法连接",
};
export function SourceSessionPanel({
  request,
  admin,
  revision,
}: {
  request: Client;
  admin: boolean;
  revision: number;
}) {
  const [session, setSession] = useState<SessionView | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!admin) return;
    let active = true;
    request<SessionView>("v2/source-session", "POST", {
      kind: "session_control",
      action: "status",
    })
      .then((d) => {
        if (active) setSession(d);
      })
      .catch((e) => {
        if (active) setError(failure(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [admin, request, revision]);
  useEffect(() => {
    if (!session?.qrExpiresAt || session.state !== "login_required") return;
    const end = session.qrExpiresAt;
    const tick = setInterval(() => {
      if (Date.now() >= end) {
        setExpired(true);
        clearInterval(tick);
        return;
      }
      request<SessionView>("v2/source-session")
        .then((d) => {
          if (d.state === "logged_in" || d.state === "verification_required")
            setSession(d);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(tick);
  }, [session?.qrExpiresAt, session?.state, request]);
  async function check(action: "status" | "login") {
    setBusy(true);
    setError("");
    setExpired(false);
    try {
      setSession(
        await request<SessionView>("v2/source-session", "POST", {
          kind: "session_control",
          action,
        }),
      );
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  }
  if (!admin) return null;
  return (
    <section
      className="console-card console-source-session"
      aria-labelledby="source-session-title"
    >
      <div className="console-panel-heading">
        <h2 id="source-session-title">
          <ShieldCheck size={22} />
          小红书登录状态
        </h2>
        <span
          className={`console-session-state ${session?.state === "logged_in" ? "is-connected" : ""}`}
          role="status"
        >
          {session ? names[session.state] : "正在检测…"}
        </span>
      </div>
      {session?.checkedAt && (
        <p className="console-session-time">
          上次检测 · {time(session.checkedAt)}
        </p>
      )}
      {session?.reason === "runner_offline" && (
        <p role="status">
          未收到来源电脑响应，请在来源电脑启动小红书搜索服务后重试。
        </p>
      )}
      {session?.reason === "check_timeout" && (
        <p role="status">登录检测超时，请稍后重试。</p>
      )}
      {session?.state === "verification_required" && (
        <p role="status">
          小红书要求安全验证。点击“重新登录”，在来源电脑打开的专用 Edge
          窗口中完成验证。
        </p>
      )}
      {session?.qr && (
        <div className="console-session-qr">
          {expired ? (
            <p role="status">二维码已过期，请点击“重新登录”获取新二维码。</p>
          ) : (
            <>
              {/* A private, short-lived source login QR; no optimization or shared cache. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={session.qr}
                width={200}
                height={200}
                alt="小红书登录二维码"
              />
              <p>用小红书 App 扫码并在手机确认</p>
            </>
          )}
        </div>
      )}
      {error && (
        <p role="status" className="console-feedback">
          {error}
        </p>
      )}
      <div className="console-actions">
        <button disabled={busy} onClick={() => void check("status")}>
          <RefreshCw size={16} />
          {busy ? "正在连接…" : "检测登录状态"}
        </button>
        <button disabled={busy} onClick={() => void check("login")}>
          <ScanLine size={16} />
          重新登录
        </button>
      </div>
    </section>
  );
}
