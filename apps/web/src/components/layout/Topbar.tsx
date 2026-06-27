"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Search, WifiOff } from "lucide-react";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { notificationsApi, tasksApi } from "@/lib/api";
import type { NotificationItem, TaskItem } from "@/lib/api";
import { apiUrl } from "@/lib/config";
import { useWS } from "@/hooks/useWS";
import { useLowDataMode } from "@/hooks/useLowDataMode";
import { useInboxCounts } from "@/hooks/useInboxCounts";
import { getBreadcrumbs, getCompactCrumbs, getPageTitle } from "@/lib/breadcrumb";
import type { Crumb } from "@/lib/breadcrumb";
import { OPEN_COMMAND_MENU_EVENT } from "./CommandMenu";

interface TopbarProps {
  onMenuClick?: () => void;
}

function MobileBreadcrumb({ items, fallbackTitle }: { items: Crumb[]; fallbackTitle: string }) {
  const current = items[items.length - 1]?.label ?? fallbackTitle;
  const ancestors = items.slice(0, -1);

  return (
    <div className="min-w-0 flex flex-col justify-center gap-0.5 overflow-hidden">
      {ancestors.length > 0 && (
        <nav
          aria-label="上層路徑"
          className="flex items-center gap-1 overflow-hidden text-[10px] leading-none">
          {ancestors.map((item, i) => (
            <span key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && (
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  className="flex-shrink-0"
                  style={{ color: "var(--text-disabled)" }}
                  aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
              {item.href ? (
                <Link
                  href={item.href}
                  className="block max-w-16 truncate transition-colors hover:opacity-80"
                  style={{ color: "var(--text-disabled)", textDecoration: "none" }}>
                  {item.label}
                </Link>
              ) : (
                <span className="block max-w-16 truncate" style={{ color: "var(--text-disabled)" }}>
                  {item.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}
      <h1
        className="truncate text-sm leading-tight"
        style={{ color: "var(--text-primary)", fontWeight: 650 }}>
        {current}
      </h1>
    </div>
  );
}

export default function Topbar({ onMenuClick }: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showBell, setShowBell] = useState(false);
  const [previewNtfs, setPreviewNtfs] = useState<NotificationItem[]>([]);
  const [previewTasks, setPreviewTasks] = useState<TaskItem[]>([]);
  const [userRoom, setUserRoom] = useState<string | null>(null);
  const lowDataMode = useLowDataMode();
  // 待辦／未讀計數輪詢：未登入（userRoom 為 null）前完全不請求；
  // 命中 401/522 等致命狀態會自動停止，不再每分鐘空打。
  const { taskCount, unreadCount, setTaskCount, setUnreadCount, refresh: refreshCounts } =
    useInboxCounts(Boolean(userRoom));
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  const crumbs = useMemo(() => getBreadcrumbs(pathname), [pathname]);
  const compactCrumbs = useMemo(() => getCompactCrumbs(crumbs), [crumbs]);
  const pageTitle = useMemo(() => getPageTitle(pathname), [pathname]);
  const parentHref = crumbs.length >= 2 ? crumbs[crumbs.length - 2]?.href : undefined;
  const showBack = crumbs.length > 2;  // 至少有 首頁 / X / Y 時才顯示

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setIsLoggedIn(!!userId);
    setUserRoom(userId ? `user:${userId}` : null);
    setUserName(localStorage.getItem("user_name") ?? "");
    setUserEmail(localStorage.getItem("user_email") ?? "");
    setUserAvatar(localStorage.getItem("user_avatar"));
    setIsSuperuser(sessionStorage.getItem("is_superuser") === "true");
  }, []);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setShowBell(false);
      }
    }
    if (showMenu || showBell) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [showMenu, showBell]);

  useWS(
    userRoom,
    useCallback((msg) => {
      if (msg.type !== "notification.created") return;
      const unread = typeof msg.unread === "number" ? msg.unread : null;
      if (unread !== null) setUnreadCount(unread);
      else refreshCounts();
      if (msg.notification && typeof msg.notification === "object") {
        setPreviewNtfs((items) => [msg.notification as NotificationItem, ...items].slice(0, 5));
      }
    }, [refreshCounts, setUnreadCount]),
    Boolean(userRoom) && !lowDataMode,
  );

  const openBell = async () => {
    setShowBell(v => !v);
    if (!showBell) {
      try {
        const [items, inbox] = await Promise.all([
          notificationsApi.list(false, 5),
          tasksApi.list().catch(() => ({ items: [] as TaskItem[], total: 0, by_module: {} })),
        ]);
        setPreviewNtfs(items);
        setPreviewTasks(inbox.items.slice(0, 5));
        setTaskCount(inbox.total);
      } catch { /* ignore */ }
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      setUnreadCount(0);
      setPreviewNtfs((items) => items.map((item) => ({ ...item, is_read: true })));
    } catch { /* ignore */ }
  };

  const handleBack = () => {
    // 優先用 router.back()，使用者可獲得正確 scroll restoration；
    // 但若 history 不足（直連深層頁），fallback 到上一層 href。
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else if (parentHref) {
      router.push(parentHref);
    } else {
      router.push("/");
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(apiUrl("/auth/logout"), {
        method: "POST",
        credentials: "include",
      });
    } catch { /* ignore */ }
    localStorage.clear();
    router.replace("/login");
  };

  const initials = userName ? userName.charAt(0).toUpperCase() : "U";

  return (
    <header
      className="flex items-center justify-between px-4 md:px-5 flex-shrink-0 gap-2"
      style={{
        height: "56px",
        background: "var(--topbar-bg)",
        borderBottom: "1px solid var(--topbar-border)",
        boxShadow: "var(--shadow-xs)",
        backdropFilter: "blur(12px) saturate(160%)",
        WebkitBackdropFilter: "blur(12px) saturate(160%)",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
      role="banner">

      {/* 左側：選單 + 返回 + 麵包屑/標題 */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          onClick={onMenuClick}
          className="topbar-icon-btn"
          aria-label="切換側邊選單">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6"  x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {showBack && (
          <button
            type="button"
            onClick={handleBack}
            className="topbar-icon-btn"
            aria-label="返回上一頁">
            <ArrowLeft size={15} aria-hidden={true} />
          </button>
        )}

        {/* 桌面：完整麵包屑 */}
        <div className="hidden md:block min-w-0 flex-1">
          <Breadcrumb items={crumbs} />
        </div>

        {/* 行動裝置：上層小字、當前頁突出顯示 */}
        <div className="md:hidden min-w-0 flex-1">
          <MobileBreadcrumb items={compactCrumbs} fallbackTitle={pageTitle} />
        </div>
      </div>

      {/* 右側：搜尋 + 通知 + 主題 + 使用者 */}
      <div className="flex items-center gap-1.5">
        {isLoggedIn && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_MENU_EVENT))}
            className="topbar-icon-btn"
            aria-label="搜尋或執行操作"
            title="搜尋或執行操作（Ctrl K）"
          >
            <Search size={15} aria-hidden={true} />
          </button>
        )}
        {isLoggedIn && (
        <div className="relative" ref={bellRef}>
          <button
            onClick={openBell}
            className="topbar-icon-btn relative"
            aria-label={`通知與待辦${(unreadCount + taskCount) > 0 ? `（${unreadCount} 則未讀通知、${taskCount} 件待辦）` : ""}`}
            aria-expanded={showBell}
            aria-haspopup="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {(unreadCount + taskCount) > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[1rem] h-4 rounded-full flex items-center justify-center text-[10px] font-bold px-1"
                style={{ background: "var(--danger)", color: "#fff" }}
                aria-hidden="true">
                {(unreadCount + taskCount) > 99 ? "99+" : (unreadCount + taskCount)}
              </span>
            )}
          </button>

          {showBell && (
            <div
              role="dialog"
              aria-label="通知預覽"
              className="absolute right-0 top-full mt-1.5 w-72 max-w-[calc(100vw-1rem)] rounded-xl z-50 animate-scale-in overflow-hidden"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-strong)",
                boxShadow: "var(--shadow-xl)",
              }}>
              {/* 待辦區 */}
              <div className="px-4 py-2.5 flex items-center justify-between"
                style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-hover)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  待辦中心
                </p>
                {taskCount > 0 && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ background: "var(--warning)", color: "#fff" }}>
                    {taskCount > 99 ? "99+" : taskCount}
                  </span>
                )}
              </div>
              <div className="max-h-44 overflow-y-auto">
                {previewTasks.length === 0 ? (
                  <p className="text-[11px] text-center py-4" style={{ color: "var(--text-muted)" }}>
                    目前沒有待辦
                  </p>
                ) : (
                  previewTasks.map((t, idx) => (
                    <div key={t.id}
                      style={idx < previewTasks.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                      <Link
                        href={t.href}
                        onClick={() => setShowBell(false)}
                        className="flex items-start gap-2 px-4 py-2.5 transition-colors"
                        style={{ textDecoration: "none", display: "flex" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                          style={{
                            background: t.severity === "critical" ? "var(--danger)"
                              : t.severity === "warning" ? "var(--warning)"
                              : "var(--primary)",
                          }}
                          aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate"
                            style={{ color: "var(--text-primary)" }}>
                            {t.title}
                          </p>
                          {t.subtitle && (
                            <p className="text-[10px] truncate mt-0.5"
                              style={{ color: "var(--text-muted)" }}>
                              {t.subtitle}
                            </p>
                          )}
                        </div>
                      </Link>
                    </div>
                  ))
                )}
              </div>
              <Link href="/tasks" onClick={() => setShowBell(false)}
                className="block px-4 py-2 text-center text-[11px] font-medium"
                style={{
                  color: "var(--primary)",
                  textDecoration: "none",
                  borderBottom: "1px solid var(--border)",
                }}>
                查看全部待辦 →
              </Link>

              {/* 通知區 */}
              <div className="px-4 py-2.5 flex items-center justify-between"
                style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-hover)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  最新通知
                </p>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{ background: "var(--danger)", color: "#fff" }}>
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    disabled={unreadCount === 0}
                    className="text-[11px] font-medium disabled:opacity-40"
                    style={{ color: "var(--primary)" }}>
                    全數已讀
                  </button>
                </div>
              </div>
              <div className="max-h-44 overflow-y-auto">
                {previewNtfs.length === 0 ? (
                  <p className="text-[11px] text-center py-4" style={{ color: "var(--text-muted)" }}>
                    目前沒有通知
                  </p>
                ) : (
                  previewNtfs.map((n, idx) => (
                    <div key={n.id}
                      style={idx < previewNtfs.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                      <Link
                        href={n.link ?? "/"}
                        onClick={() => setShowBell(false)}
                        className="flex items-start gap-2 px-4 py-2.5 transition-colors"
                        style={{ textDecoration: "none", display: "flex" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        {!n.is_read && (
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                            style={{ background: "var(--primary)" }} aria-hidden="true" />
                        )}
                        <div className={`flex-1 min-w-0 ${n.is_read ? "pl-3" : ""}`}>
                          <p className="text-xs font-medium truncate"
                            style={{ color: "var(--text-primary)" }}>
                            {n.title}
                          </p>
                          <p className="text-[10px] mt-0.5"
                            style={{ color: "var(--text-disabled)" }}>
                            {new Date(n.created_at).toLocaleDateString("zh-TW")}
                          </p>
                        </div>
                      </Link>
                    </div>
                  ))
                )}
              </div>
              <div className="px-4 py-2" style={{ borderTop: "1px solid var(--border)" }}>
                <Link href="/notifications" onClick={() => setShowBell(false)}
                  className="block text-center text-[11px] font-medium"
                  style={{ color: "var(--primary)", textDecoration: "none" }}>
                  查看全部通知 →
                </Link>
              </div>
            </div>
          )}
        </div>
        )}

        <ThemeToggle />

        <div className="w-px h-4 mx-1" style={{ background: "var(--border)" }} aria-hidden="true" />

        {isLoggedIn ? (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowMenu((p) => !p)}
              className="flex items-center gap-2 h-9 px-2 rounded-lg transition-colors cursor-pointer"
              style={{
                border: "1px solid var(--border)",
                background: showMenu ? "var(--bg-hover)" : "transparent",
              }}
              aria-label="使用者選單"
              aria-expanded={showMenu}
              aria-haspopup="menu">

              {userAvatar ? (
                <Image
                  src={userAvatar}
                  alt={userName}
                  width={24}
                  height={24}
                  unoptimized
                  className="w-6 h-6 rounded-full object-cover"
                  style={{ border: "1.5px solid var(--primary)", opacity: 0.92 }}
                />
              ) : (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
                  style={{
                    background: "linear-gradient(135deg, rgba(201,168,76,0.18) 0%, rgba(201,168,76,0.08) 100%)",
                    color: "var(--primary)",
                    border: "1.5px solid rgba(201,168,76,0.35)",
                  }}
                  aria-hidden="true">
                  {initials}
                </div>
              )}

              <span className="text-xs font-medium max-w-24 truncate hidden sm:block"
                style={{ color: "var(--text-secondary)" }}>
                {userName || "使用者"}
              </span>

              {isSuperuser && (
                <span
                  className="hidden sm:block text-[10px] px-1.5 py-0.5 rounded-sm font-medium leading-none"
                  style={{
                    background: "rgba(245,158,11,0.12)",
                    color: "var(--warning)",
                    border: "1px solid var(--warning-border)",
                  }}>
                  管理員
                </span>
              )}

              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{
                  color: "var(--text-muted)",
                  transition: "transform 150ms",
                  transform: showMenu ? "rotate(180deg)" : "rotate(0deg)",
                }}
                aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {showMenu && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1.5 w-52 max-w-[calc(100vw-1rem)] rounded-xl z-50 animate-scale-in overflow-hidden"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-strong)",
                  boxShadow: "var(--shadow-xl)",
                }}>
                <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {userName || "—"}
                  </p>
                  <p className="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {userEmail}
                  </p>
                </div>

                <div className="py-1" role="none">
                  <Link
                    href="/profile"
                    role="menuitem"
                    onClick={() => setShowMenu(false)}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors cursor-pointer"
                    style={{ color: "var(--text-secondary)", textDecoration: "none", display: "flex" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    個人資料
                  </Link>
                  <Link
                    href="/settings/notifications"
                    role="menuitem"
                    onClick={() => setShowMenu(false)}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors cursor-pointer"
                    style={{ color: "var(--text-secondary)", textDecoration: "none", display: "flex" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    通知偏好
                  </Link>
                  <Link
                    href="/settings/data-saver"
                    role="menuitem"
                    onClick={() => setShowMenu(false)}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors cursor-pointer"
                    style={{ color: "var(--text-secondary)", textDecoration: "none", display: "flex" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <WifiOff size={14} aria-hidden={true} />
                    省流模式
                  </Link>
                  <Link
                    href="/settings/security"
                    role="menuitem"
                    onClick={() => setShowMenu(false)}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors cursor-pointer"
                    style={{ color: "var(--text-secondary)", textDecoration: "none", display: "flex" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    安全設定
                  </Link>

                  <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />

                  <button
                    role="menuitem"
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors cursor-pointer"
                    style={{ color: "var(--danger)", background: "transparent", border: "none", width: "100%" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--danger-dim)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    登出
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Link
            href="/login"
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: "var(--primary-dim)",
              color: "var(--primary-text)",
              border: "1px solid var(--border-strong)",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            登入
          </Link>
        )}
      </div>
    </header>
  );
}
