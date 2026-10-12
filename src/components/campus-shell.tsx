"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Map,
  Radar,
  BookOpen,
  CalendarDays,
  Bookmark,
  UserRound,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { AssistantPanel } from "@/features/assistant/components/assistant-panel";

const navigation = [
  { href: "/map", label: "校园地图", short: "地图", icon: Map },
  { href: "/radar", label: "校园雷达", short: "雷达", icon: Radar },
  { href: "/knowledge", label: "校园知识", short: "知识", icon: BookOpen },
  { href: "/schedule", label: "个人日程", short: "日程", icon: CalendarDays },
  { href: "/favorites", label: "我的收藏", short: "收藏", icon: Bookmark },
  { href: "/account", label: "我的账号", short: "我的", icon: UserRound },
];

export function CampusShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  return (
    <div
      className={`campus-shell ${expanded ? "nav-expanded" : ""} ${assistantOpen ? "assistant-visible" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar glass-surface" aria-label="侧边栏">
        <Link
          className="brand"
          href="/map"
          aria-label="广外通 CampusOS 首页"
          title="广外通 CampusOS"
        >
          <span className="brand-symbol" aria-hidden="true">
            C<span>.</span>
          </span>
          <span className="brand-word">
            广外通<small>CampusOS</small>
          </span>
        </Link>
        <nav className="desktop-navigation" aria-label="桌面主导航">
          <div className="nav-primary">
            {navigation
              .slice(0, 5)
              .map(({ href, label, short, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`nav-item ${pathname === href ? "active" : ""}`}
                  aria-current={pathname === href ? "page" : undefined}
                  aria-label={label}
                  title={label}
                >
                  <Icon size={21} strokeWidth={1.7} />
                  <span>{label}</span>
                  <small className="nav-tooltip" aria-hidden="true">
                    {short}
                  </small>
                </Link>
              ))}
          </div>
          <div className="nav-secondary">
            <button
              className="nav-toggle"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? "收起导航" : "展开导航"}
              aria-expanded={expanded}
              title={expanded ? "收起导航" : "展开导航"}
            >
              {expanded ? (
                <PanelLeftClose size={20} strokeWidth={1.7} />
              ) : (
                <PanelLeftOpen size={20} strokeWidth={1.7} />
              )}
              <span>{expanded ? "收起导航" : "展开导航"}</span>
            </button>
            <Link
              href="/account"
              className={`nav-item nav-account ${pathname === "/account" ? "active" : ""}`}
              aria-label="我的账号"
              aria-describedby="visitor-label"
              aria-current={pathname === "/account" ? "page" : undefined}
              title="我的账号 · 游客"
            >
              <span className="account-avatar">
                <UserRound size={20} strokeWidth={1.7} />
              </span>
              <span className="account-caption">
                我的账号<small>游客模式</small>
              </span>
              <small id="visitor-label" className="nav-guest">
                游客
              </small>
            </Link>
          </div>
        </nav>
      </aside>
      <main id="main-content" className="main-content">
        {children}
      </main>
      <AssistantPanel open={assistantOpen} onOpenChange={setAssistantOpen} />
      <nav className="mobile-navigation glass-surface" aria-label="手机主导航">
        {navigation
          .filter((item) => item.href !== "/favorites")
          .map(({ href, short, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-label={href === "/account" ? "我的账号" : short}
              aria-current={
                pathname === href ||
                (href === "/account" && pathname === "/favorites")
                  ? "page"
                  : undefined
              }
            >
              <span className="tab-icon">
                <Icon size={22} strokeWidth={1.7} />
              </span>
              <span>{short}</span>
            </Link>
          ))}
      </nav>
    </div>
  );
}
