"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn, MoreHorizontal } from "lucide-react";
import { useWS } from "@/hooks/useWS";
import { useInboxCounts } from "@/hooks/useInboxCounts";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import { NAV_ID_TO_MODULE, moduleForPath } from "@/lib/modules";
import {
  filterNavItems,
  NAV_PREF_EVENT,
  orderedItems,
  readNavPreferences,
  type NavItem,
} from "@/lib/navigation";
import NavIcon from "./NavIcon";

interface BottomTabBarProps {
  onMoreClick: () => void;
}

type IconProps = { size: number; "aria-hidden": boolean };

interface Tab {
  href?: string;
  label: string;
  iconKey?: string;
  icon?: (p: IconProps) => React.ReactNode;
  match?: (pathname: string) => boolean;
  badgeKey?: "tasks" | "notifs";
  onClick?: () => void;
}

type Role = "guest" | "student" | "cadre";

const CADRE_PREFIXES = ["document:", "regulation:", "audit:"] as const;

/**
 * 手機底部 tab bar（< md 顯示）。
 * 依使用者身分顯示三套不同 tab：
 *  - guest：法規/公告/特約/陳情/登入（皆公開可讀）
 *  - student：首頁/學餐/校商/問卷/更多
 *  - cadre：首頁/待辦/公文/法規/更多（有公文、法規或審計權限者）
 */
export default function BottomTabBar({ onMoreClick }: BottomTabBarProps) {
  const pathname = usePathname();
  const [role, setRole] = useState<Role>("guest");
  const [roleResolved, setRoleResolved] = useState(false);
  const [userRoom, setUserRoom] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [navPrefs, setNavPrefs] = useState(() => readNavPreferences());
  const { isModuleClosed } = useModuleStatus();
  // 待辦／未讀計數輪詢：訪客（未登入）不請求；致命狀態會自動停止。
  const {
    taskCount,
    unreadCount: notifCount,
    setUnreadCount: setNotifCount,
    refresh: refreshCounts,
  } = useInboxCounts(role !== "guest");

  // 解析身分（依登入狀態與權限分桶）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const userId = localStorage.getItem("user_id");
    setUserRoom(userId ? `user:${userId}` : null);
    if (!userId) {
      setRole("guest");
      setRoleResolved(true);
      return;
    }
    const superuser = localStorage.getItem("is_superuser") === "true";
    const owner = localStorage.getItem("is_owner") === "true";
    let perms: string[] = [];
    try {
      const raw = localStorage.getItem("permissions");
      perms = raw ? JSON.parse(raw) : [];
    } catch { /* ignore */ }
    const isCadre =
      superuser
      || owner
      || perms.includes("admin:all")
      || perms.some((p) => CADRE_PREFIXES.some((pre) => p.startsWith(pre)));
    setRole(isCadre ? "cadre" : "student");
    setRoleResolved(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncPrefs = () => setNavPrefs(readNavPreferences());
    window.addEventListener(NAV_PREF_EVENT, syncPrefs);
    window.addEventListener("storage", syncPrefs);
    return () => {
      window.removeEventListener(NAV_PREF_EVENT, syncPrefs);
      window.removeEventListener("storage", syncPrefs);
    };
  }, []);

  useWS(userRoom, useCallback((msg) => {
    if (msg.type !== "notification.created") return;
    const unread = typeof msg.unread === "number" ? msg.unread : null;
    if (unread !== null) setNotifCount(unread);
    else refreshCounts();
  }, [refreshCounts, setNotifCount]), role !== "guest");

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

  const tabs: Tab[] = useMemo(() => {
    if (role === "guest") {
      const guestTabs: Tab[] = [
        { href: "/regulations",   label: "法規", iconKey: "regulations",   match: (p) => p.startsWith("/regulations") },
        { href: "/announcements", label: "公告", iconKey: "announcement",  match: (p) => p.startsWith("/announcements") },
        { href: "/partner-map",   label: "特約", iconKey: "partnerMap",    match: (p) => p.startsWith("/partner-map") },
        { href: "/petitions/new", label: "陳情", iconKey: "petition",      match: (p) => p.startsWith("/petitions") },
        { href: "/login",         label: "登入", icon: (p) => <LogIn {...p} />,         match: (p) => p === "/login" },
      ];
      return guestTabs.filter(
        (tab) => !tab.href || !isModuleClosed(moduleForPath(tab.href)),
      );
    }
    const superuser = typeof window !== "undefined" && (
      localStorage.getItem("is_superuser") === "true" || localStorage.getItem("is_owner") === "true"
    );
    let perms = new Set<string>();
    try {
      perms = new Set(JSON.parse(localStorage.getItem("permissions") || "[]"));
    } catch { /* ignore */ }
    const can = (code: string) => superuser || perms.has("admin:all") || perms.has(code);
    const hasPrefix = (prefix: string) =>
      superuser || perms.has("admin:all") || Array.from(perms).some((perm) => perm.startsWith(prefix));
    const available = filterNavItems(
      orderedItems(navPrefs.mobileOrder, navPrefs.mobileHidden),
      can,
      hasPrefix,
    ).filter((item) => !isModuleClosed(NAV_ID_TO_MODULE[item.id] ?? null));
    const topTabs = available.slice(0, 4).map(navItemToTab);
    return [...topTabs, { label: "更多", icon: (p) => <MoreHorizontal {...p} />, onClick: onMoreClick }];
  }, [navPrefs, role, onMoreClick, isModuleClosed]);

  if (keyboardOpen) return null;
  if (!roleResolved) return null;

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
              {t.iconKey ? <NavIcon iconKey={t.iconKey} size={20} /> : Icon?.({ size: 20, "aria-hidden": true })}
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

function navItemToTab(item: NavItem): Tab {
  return {
    href: item.href,
    label: item.label.replace("系統", "").replace("專區", "").replace("訂購", ""),
    iconKey: item.iconKey,
    match: (pathname) => item.end
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(item.href + "/"),
    badgeKey: item.id === "tasks" ? "tasks" : undefined,
  };
}
