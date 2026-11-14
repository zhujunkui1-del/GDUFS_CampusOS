import type { Metadata } from "next";
import { Suspense } from "react";
import { ConsoleApp } from "@/features/console/console-app";
export const metadata: Metadata = {
  title: "CampusOS Console",
  robots: { index: false, follow: false },
};
// Only the public, data-free shell is prerendered. Every private read/write
// still goes through the authenticated management API.
export const dynamicParams = false;
export function generateStaticParams() {
  return [
    [],
    ["sources"],
    ["jobs"],
    ["reviews"],
    ["articles"],
    ["web-collection"],
    ["collector"],
    ["content"],
    ["audit"],
    ["retention"],
    ["whitelist"],
    ["feedback"],
  ].map((section) => ({ section }));
}
export default function ConsolePage() {
  return (
    <Suspense
      fallback={
        <main className="console-login">
          <h1>CampusOS Console</h1>
          <p>正在加载…</p>
        </main>
      }
    >
      <ConsoleApp />
    </Suspense>
  );
}
