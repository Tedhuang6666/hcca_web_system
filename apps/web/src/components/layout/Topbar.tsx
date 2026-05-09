"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { notificationsApi } from "@/lib/api";
import type { NotificationItem } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const PAGE_TITLES: Record<string, string> = {
  "/":                  "儀表板",
  "/documents":         "公文系統",
  "/documents/new":     "新增公文",
  "/documents/delegations": "簽核代理",
  "/regulations":       "法規查詢",
  "/regulations/new":   "新增法規",
  "/serial-templates":  "字號模板",
  "/shop":              "訂購系統",
  "/shop/orders":       "我的訂單",
  "/shop/admin":        "商品管理",
  "/meal":              "學餐訂購",
  "/meal/orders":       "我的餐單",
  "/meal/vendor":       "商家管理",
  "/surveys":           "問卷填答",
  "/surveys/new":       "新增問卷",
  "/petitions":         "陳情系統",
  "/petitions/new":     "我要陳情",
  "/petitions/manage":  "陳情管理",
  "/petitions/admin/types": "陳情類型",
  "/orgs":              "組織總覽",
  "/announcements":     "公告檢視",
  "/announcements/new": "新增公告",
  "/notifications":     "通知中心",
  "/admin/permissions": "權限管理",
  "/profile":           "個人資料",
};

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (/^\/documents\/.+\/edit$/.test(pathname)) return "編輯公文";
  if (/^\/documents\/.+$/.test(pathname)) return "公文詳情";
  if (/^\/regulations\/.+\/edit$/.test(pathname)) return "編輯法規";
  if (/^\/regulations\/.+$/.test(pathname)) return "法規詳情";
  if (/^\/announcements\/.+\/edit$/.test(pathname)) return "編輯公告";
  if (/^\/announcements\/.+$/.test(pathname)) return "公告詳情";
  if (/^\/surveys\/.+$/.test(pathname)) return "問卷詳情";
  if (/^\/orgs\/.+$/.test(pathname)) return "組織詳情";
  return "校園自治整合平台";
}

interface TopbarProps {
  onMenuClick?: () => void;
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [previewNtfs, setPreviewNtfs] = useState<NotificationItem[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  const pageTitle = getPageTitle(pathname);

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setIsLoggedIn(!!userId);
    setUserName(localStorage.getItem("user_name") ?? "");
    setUserEmail(localStorage.getItem("user_email") ?? "");
    setUserAvatar(localStorage.getItem("user_avatar"));
    setIsSuperuser(localStorage.getItem("is_superuser") === "true");
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

  // 通知輪詢
  useEffect(() => {
    const userId = typeof window !== "undefined" ? localStorage.getItem("user_id") : null;
    if (!userId) return;
    let mounted = true;
    const fetchCount = async () => {
      try {
        const { unread } = await notificationsApi.count();
        if (mounted) setUnreadCount(unread);
      } catch { /* ignore */ }
    };
    fetchCount();
    const timer = setInterval(fetchCount, 60_000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  const openBell = async () => {
    setShowBell(v => !v);
    if (!showBell) {
      try {
        const items = await notificationsApi.list(false, 5);
        setPreviewNtfs(items);
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

  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
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
      className="flex items-center justify-between px-4 md:px-5 flex-shrink-0"
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

      {/* 左側 */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="topbar-icon-btn lg:hidden"
          aria-label="開啟側邊選單">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6"  x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1
          className="text-sm truncate"
          style={{
            color: "var(--text-primary)",
            fontFamily: "'Noto Serif TC', serif",
            fontWeight: 600,
            letterSpacing: "0.06em",
          }}>
          {pageTitle}
        </h1>
      </div>

      {/* 右側 */}
      <div className="flex items-center gap-1.5">
        {/* 通知鈴鐺 */}
        {isLoggedIn && (
        <div className="relative" ref={bellRef}>
          <button
            onClick={openBell}
            className="topbar-icon-btn relative"
            aria-label={`通知中心${unreadCount > 0 ? `（${unreadCount} 則未讀）` : ""}`}
            aria-expanded={showBell}
            aria-haspopup="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[1rem] h-4 rounded-full flex items-center justify-center text-[10px] font-bold px-1"
                style={{ background: "var(--danger)", color: "#fff" }}
                aria-hidden="true">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          {showBell && (
            <div
              role="dialog"
              aria-label="通知預覽"
              className="absolute right-0 top-full mt-1.5 w-72 rounded-xl z-50 animate-scale-in overflow-hidden"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-strong)",
                boxShadow: "var(--shadow-xl)",
              }}>
              <div className="px-4 py-3 flex items-center justify-between"
                style={{ borderBottom: "1px solid var(--border)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>通知</p>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{ background: "var(--danger)", color: "#fff" }}>
                      {unreadCount} 則未讀
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    disabled={unreadCount === 0}
                    className="text-xs font-medium disabled:opacity-40"
                    style={{ color: "var(--primary)" }}>
                    全數已讀
                  </button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {previewNtfs.length === 0 ? (
                  <p className="text-xs text-center py-6" style={{ color: "var(--text-muted)" }}>
                    目前沒有通知
                  </p>
                ) : (
                  previewNtfs.map((n, idx) => (
                    <div key={n.id}
                      style={idx < previewNtfs.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                      <Link
                        href={n.link ?? "/"}
                        onClick={() => setShowBell(false)}
                        className="flex items-start gap-3 px-4 py-3 transition-colors"
                        style={{ textDecoration: "none", display: "flex" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        {!n.is_read && (
                          <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                            style={{ background: "var(--primary)" }} aria-hidden="true" />
                        )}
                        <div className={`flex-1 min-w-0 ${n.is_read ? "pl-5" : ""}`}>
                          <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
                              {n.body}
                            </p>
                          )}
                          <p className="text-[10px] mt-1" style={{ color: "var(--text-disabled)" }}>
                            {new Date(n.created_at).toLocaleDateString("zh-TW")}
                          </p>
                        </div>
                      </Link>
                    </div>
                  ))
                )}
              </div>
              <div className="px-4 py-2.5" style={{ borderTop: "1px solid var(--border)" }}>
                <Link href="/" onClick={() => setShowBell(false)}
                  className="block text-center text-xs font-medium"
                  style={{ color: "var(--primary)", textDecoration: "none" }}>
                  到儀表板查看 →
                </Link>
              </div>
            </div>
          )}
        </div>
        )}

        {/* 深淺色切換 */}
        <ThemeToggle />

        {/* 分隔 */}
        <div className="w-px h-4 mx-1" style={{ background: "var(--border)" }} aria-hidden="true" />

        {/* 使用者選單 / 登入按鈕 */}
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
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={userAvatar}
                  alt={userName}
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
                    fontFamily: "'Noto Serif TC', serif",
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
                className="absolute right-0 top-full mt-1.5 w-52 rounded-xl z-50 animate-scale-in overflow-hidden"
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
              color: "var(--primary)",
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
