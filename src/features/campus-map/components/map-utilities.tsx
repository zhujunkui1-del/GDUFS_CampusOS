"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { UserRound, BarChart3, X } from "lucide-react";
import { useAccount } from "@/features/account/account-context";
import { TrafficPanel } from "@/features/console/dashboard-panels";
import { FeedbackEntry } from "@/features/feedback/feedback-dialog";
async function requestPublicTraffic<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok || !result.ok)
    throw new Error(result.error?.message || "暂时无法获取，请重试。");
  return result.data as T;
}

export function MapUtilities() {
  const user = useAccount().session?.user;
  const [trafficOpen, setTrafficOpen] = useState(false);
  useEffect(() => {
    if (!trafficOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTrafficOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [trafficOpen]);
  return (
    <>
      <Link
        className="mobile-account glass-surface map-account-fixed"
        href="/account"
        aria-label={
          user ? `我的账号，${user.username}` : "我的账号，当前为游客"
        }
        title={user ? user.username : "游客模式"}
      >
        {user ? (
          <span className="map-account-avatar" aria-hidden="true">
            {user.username.slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <UserRound size={20} strokeWidth={1.6} />
        )}
      </Link>
      <button
        type="button"
        className="map-traffic-trigger glass-surface"
        aria-label="访问量"
        aria-expanded={trafficOpen}
        aria-controls="public-traffic-panel"
        onClick={() => setTrafficOpen((value) => !value)}
      >
        <BarChart3 size={21} />
      </button>
      <FeedbackEntry />
      {trafficOpen && (
        <div
          className="map-traffic-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTrafficOpen(false);
          }}
        >
          <section
            className="map-traffic-popover"
            id="public-traffic-panel"
            aria-label="网站访问量"
            role="dialog"
            aria-modal="true"
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                const panel = event.currentTarget;
                const focusable = Array.from(
                  panel.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
                  ),
                ).filter((element) => element.getClientRects().length > 0);
                if (!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <div className="map-traffic-popover-heading">
              <h2>
                <BarChart3 size={21} />
                访问量
              </h2>
              <button
                autoFocus
                type="button"
                aria-label="关闭访问量"
                onClick={() => setTrafficOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <TrafficPanel
              request={requestPublicTraffic}
              revision={0}
              publicRead
            />
          </section>
        </div>
      )}
    </>
  );
}
