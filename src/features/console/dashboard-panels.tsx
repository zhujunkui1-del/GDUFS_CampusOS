"use client";
import "./traffic-panel.css";
import { useEffect, useState } from "react";
import { BarChart3, CalendarDays, Eye, RefreshCw } from "lucide-react";
import type { TrafficSummary } from "@/domain/console/dashboard";

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
  publicRead = false,
}: {
  request: Client;
  revision: number;
  publicRead?: boolean;
}) {
  const [data, setData] = useState<TrafficSummary | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [range, setRange] = useState<7 | 30>(7);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let active = true;
    request<TrafficSummary>(publicRead ? "/api/public/traffic" : "v2/traffic")
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
  }, [request, refresh, revision, publicRead]);
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
        {!publicRead && (
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
        )}
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
            <div className="console-traffic-title">
              <h3>近{range}天访问趋势</h3>
              {publicRead && (
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
              )}
            </div>
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
          {!publicRead && (
            <p className="console-traffic-note">
              页面浏览量（PV），北京时间；自 {time(data.startedAt)}{" "}
              起记录，之前未统计。
            </p>
          )}
        </>
      )}
    </section>
  );
}
