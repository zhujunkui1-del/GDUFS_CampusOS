"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Map,
  Radar,
  BookOpen,
  CalendarDays,
  Bookmark,
  UserRound,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
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
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const assistantWasOpen = useRef(false);

  function closeAssistant() {
    setAssistantOpen(false);
  }

  useEffect(() => {
    if (!assistantOpen) {
      if (assistantWasOpen.current) launcher.current?.focus();
      assistantWasOpen.current = false;
      return;
    }
    assistantWasOpen.current = true;
    closeButton.current?.focus();
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAssistantOpen(false);
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [assistantOpen]);

  return (
    <div
      className={`campus-shell ${expanded ? "nav-expanded" : ""} ${assistantOpen ? "assistant-visible" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="topbar">
        <Link className="brand" href="/map" aria-label="广外通首页">
          <span className="brand-mark">广</span>
          <span className="brand-word">
            广外通<span>CampusOS</span>
          </span>
        </Link>
        <span className="campus-chip">
          <span className="campus-dot" />
          大学城校区
        </span>
        <div className="header-right">
          <span className="guest-label">游客</span>
          <Link
            className="account-link"
            href="/account"
            aria-label="打开我的账号"
          >
            <UserRound size={19} />
          </Link>
        </div>
      </header>

      <aside className="sidebar" aria-label="侧边栏">
        <nav aria-label="桌面主导航">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`nav-item ${pathname === href ? "active" : ""}`}
              aria-current={pathname === href ? "page" : undefined}
              aria-label={label}
              title={label}
            >
              <Icon size={21} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <button
          className="nav-toggle"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "收起导航" : "展开导航"}
          aria-expanded={expanded}
        >
          {expanded ? (
            <PanelLeftClose size={19} />
          ) : (
            <PanelLeftOpen size={19} />
          )}
        </button>
      </aside>

      <main id="main-content" className="main-content">
        {children}
      </main>

      <button
        ref={launcher}
        className="assistant-launcher"
        onClick={() =>
          assistantOpen ? closeAssistant() : setAssistantOpen(true)
        }
        aria-label={assistantOpen ? "关闭校园助理" : "打开校园助理"}
        aria-controls="campus-assistant"
        aria-expanded={assistantOpen}
      >
        <Sparkles size={20} />
        <span>问 AI</span>
      </button>

      {assistantOpen && (
        <AssistantPanel closeButtonRef={closeButton} onClose={closeAssistant} />
      )}

      <nav className="mobile-navigation" aria-label="手机主导航">
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
              <Icon size={21} />
              <span>{short}</span>
            </Link>
          ))}
      </nav>
    </div>
  );
}
