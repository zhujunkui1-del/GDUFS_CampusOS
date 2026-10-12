import type { Metadata, Viewport } from "next";
import { APP } from "@/lib/app";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#f4f6f9",
  colorScheme: "light",
};

export const metadata: Metadata = {
  metadataBase: new URL(APP.origin),
  title: { default: APP.name, template: "%s · 广外通" },
  description: "广外大学城校区地图、校园知识与 AI 校园助理。",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
