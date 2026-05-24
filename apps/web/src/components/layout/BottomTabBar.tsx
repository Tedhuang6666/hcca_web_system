"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid, Inbox, Landmark, ShoppingCart, MoreHorizontal,
} from "lucide-react";
import { notificationsApi, tasksApi } from "@/lib/api";

interface BottomTabBarProps {
  onMoreClick: () => void;
}

type IconProps = { size: number; "aria-hidden": boolean };

interface Tab {
  href?: string;
  label: string;
  icon: (p: IconProps) => React.ReactNode;
  match?: (pathname: string) => boolean;
  badgeKey?: "tasks" | "notifs";
  onClick?: () => void;
}

const HOME_PATH = "/";
const TASKS_PATH = "/tasks";
const MEETINGS_PATH = "/meetings";
const SHOP_PATH = "/shop";

/**
 * 手機底部 tab bar（< md 顯示）。
 * 提供 5 個常用入口，減少反覆開合 hamburger 的次數。
 * 鍵盤彈起時透過 visualViewport 自動隱藏避免擋輸入欄。
 */
export default function BottomTabBar({ onMoreClick }: BottomTabBarProps) {
  const pathname = usePathname();
  const [taskCount, setTaskCount] = useState(0);
  const [notifCount, setNotifCount] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const userId = typeof window !== "undefined" ? localStorage.getItem("user_id") : null;
    if (!userId) return;
    let mounted = true;
    const fetchCounts = async () => {
      try {
        const inbox = await tasksApi.list();
        if (mounted) setTaskCount(inbox.total);
      } catch { /* ignore */ }
      try {
        const { unread } = await notificationsApi.count();
        if (mounted) setNotifCount(unread);
      } catch { /* ignore */ }
    };
    fetchCounts();
    const timer = setInterval(fetchCounts, 60_000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  // 鍵盤彈起偵測：visualViewport 高度顯著縮小時隱藏
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const handler = () => {
      const ratio = vv.height / window.innerHeight;
      setKeyboardOpen(ratio < 0.75);
    };
    vv.addEventListener("resize", handler);
    return () => vv.removeEventListener("resize", handler);
  }, []);

  const tabs: Tab[] = [
    { href: HOME_PATH,     label: "首頁", icon: (p) => <LayoutGrid {...p} />, match: (p) => p === HOME_PATH },
    { href: TASKS_PATH,    label: "待辦", icon: (p) => <Inbox {...p} />, match: (p) => p.startsWith(TASKS_PATH), badgeKey: "tasks" },
    { href: MEETINGS_PATH, label: "議事", icon: (p) => <Landmark {...p} />, match: (p) => p.startsWith(MEETINGS_PATH) },
    { href: SHOP_PATH,     label: "服務", icon: (p) => <ShoppingCart {...p} />, match: (p) => p.startsWith(SHOP_PATH) || p.startsWith("/meal") || p.startsWith("/announcements") || p.startsWith("/surveys") || p.startsWith("/partner-map") },
    { label: "更多", icon: (p) => <MoreHorizontal {...p} />, onClick: onMoreClick },
  ];

  if (keyboardOpen) return null;

  return (
    <nav
      aria-label="底部主選單"
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex"
      style={{
        height: "56px",
        background: "var(--bg-elevated)",
        borderTop: "1px solid var(--border)",
        paddingBottom: "env(safe-area-inset-bottom)",
        boxShadow: "0 -2px 8px rgba(0,0,0,0.04)",
      }}>
      {tabs.map((t) => {
        const active = t.match ? t.match(pathname) : false;
        const badge =
          t.badgeKey === "tasks" ? taskCount :
          t.badgeKey === "notifs" ? notifCount : 0;
        const Icon = t.icon;

        const inner = (
          <div className="relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full"
            style={{
              color: active ? "var(--primary)" : "var(--text-muted)",
              transition: "color 150ms",
            }}>
            <span className="relative">
              <Icon size={20} aria-hidden={true} />
              {badge > 0 && (
                <span
                  className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{ background: "var(--danger)", color: "#fff" }}
                  aria-hidden="true">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium" style={{ letterSpacing: 0 }}>
              {t.label}
            </span>
          </div>
        );

        if (t.href) {
          return (
            <Link
              key={t.label}
              href={t.href}
              className="flex-1 flex"
              style={{ textDecoration: "none", minHeight: 44 }}
              aria-current={active ? "page" : undefined}
              aria-label={`${t.label}${badge > 0 ? `（${badge}）` : ""}`}>
              {inner}
            </Link>
          );
        }
        return (
          <button
            key={t.label}
            type="button"
            onClick={t.onClick}
            className="flex-1 flex bg-transparent border-0 p-0"
            style={{ minHeight: 44 }}
            aria-label={t.label}>
            {inner}
          </button>
        );
      })}
    </nav>
  );
}
