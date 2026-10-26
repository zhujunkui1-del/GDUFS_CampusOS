"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

let lastPath: string | null = null;
let queued = 0;
let pending: { id: string; views: number } | null = null;
let sending = false;
async function flush() {
  if (sending || (!queued && !pending)) return;
  if (!pending) {
    pending = { id: crypto.randomUUID(), views: Math.min(20, queued) };
    queued -= pending.views;
  }
  const batch = pending;
  sending = true;
  try {
    const response = await fetch("/api/public/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
      keepalive: true,
    });
    await response.arrayBuffer();
    if (response.ok) pending = null;
  } catch {
    /* Retain the same id for a later retry. */
  } finally {
    sending = false;
  }
}
export function VisitTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === lastPath) return;
    lastPath = pathname;
    if (
      !/^\/(map|radar|knowledge|schedule|account|favorites|articles)(\/|$)/.test(
        pathname,
      )
    )
      return;
    queued = Math.min(20, queued + 1);
  }, [pathname]);
  useEffect(() => {
    const timer = setInterval(() => void flush(), 5000);
    const hidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const leave = () => void flush();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
      void flush();
    };
  }, []);
  return null;
}
