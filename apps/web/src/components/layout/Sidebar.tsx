"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/* ── SVG Icons ───────────────────────────────────────────────────────────── */
const Icons: Record<string, () => React.ReactElement> = {
  dashboard: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  documents: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="12" y2="17" />
    </svg>
  ),
  documentNew: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="13" x2="12" y2="17" />
      <line x1="10" y1="15" x2="14" y2="15" />
    </svg>
  ),
  regulations: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  regulationNew: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </svg>
  ),
  serial: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  ),
  shop: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  ),
  shopAdmin: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  survey: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  surveyNew: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </svg>
  ),
  meal: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
      <line x1="6" y1="1" x2="6" y2="4" />
      <line x1="10" y1="1" x2="10" y2="4" />
      <line x1="14" y1="1" x2="14" y2="4" />
    </svg>
  ),
  mealVendor: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  announcement: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  petition: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  ),
  notifications: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  permissions: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  audit: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      <path d="M8 7h4" />
      <path d="M8 17h8" />
    </svg>
  ),
  org: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <rect x="1" y="14" width="6" height="4" rx="1" />
      <rect x="9" y="14" width="6" height="4" rx="1" />
      <rect x="17" y="14" width="6" height="4" rx="1" />
      <path d="M4 14v-3a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3" />
      <line x1="12" y1="6" x2="12" y2="10" />
    </svg>
  ),
  profile: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  chevronRight: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
};

/* ── Nav 資料結構 ─────────────────────────────────────────────────────────── */
type NavItem = {
  href: string;
  iconKey: string;
  label: string;
  end?: boolean;
  perm?: string;
  currentOnly?: boolean;
};
type NavSection = { heading: string; items: NavItem[]; perm?: string };

const NAV_DEF: (NavItem | NavSection)[] = [
  { href: "/", iconKey: "dashboard", label: "儀表板", end: true },
  {
    heading: "公文與法規",
    items: [
      { href: "/documents",        iconKey: "documents",     label: "公文系統" },
      {
        href: "/documents/new",
        iconKey: "documentNew",
        label: "新增公文",
        perm: "document:create",
        currentOnly: true,
      },
      { href: "/regulations",      iconKey: "regulations",   label: "法規查詢" },
      {
        href: "/regulations/new",
        iconKey: "regulationNew",
        label: "新增法規",
        perm: "regulation:create",
        currentOnly: true,
      },
    ],
  },
  {
    heading: "服務",
    items: [
      { href: "/announcements", iconKey: "announcement", label: "公告檢視" },
      {
        href: "/announcements/new",
        iconKey: "announcement",
        label: "新增公告",
        perm: "announcement:create",
        currentOnly: true,
      },
      { href: "/shop",        iconKey: "shop",       label: "訂購系統" },
      { href: "/meal",        iconKey: "meal",       label: "學餐訂購" },
      { href: "/surveys",     iconKey: "survey",     label: "問卷填答" },
      { href: "/petitions",   iconKey: "petition",   label: "陳情系統" },
    ],
  },
  {
    heading: "管理",
    items: [
      { href: "/orgs",              iconKey: "org",         label: "組織管理", perm: "org:*" },
      { href: "/admin/permissions", iconKey: "permissions", label: "權限管理", perm: "admin:all" },
      { href: "/audit-logs",        iconKey: "audit",       label: "稽核日誌", perm: "audit:view_org" },
      { href: "/serial-templates",  iconKey: "serial",      label: "字號模板", perm: "doc.issue" },
      { href: "/shop/admin",        iconKey: "shopAdmin",   label: "商品管理", perm: "shop:manage" },
      { href: "/meal/vendor",       iconKey: "mealVendor",  label: "商家管理", perm: "meal:manage" },
      { href: "/petitions/manage",  iconKey: "petition",    label: "陳情管理", perm: "petition:*" },
    ],
  },
];

const NAV_DEF_LOGGED_OUT: (NavItem | NavSection)[] = [
  {
    heading: "公開",
    items: [
      { href: "/regulations", iconKey: "regulations", label: "法規查詢" },
      { href: "/documents", iconKey: "documents", label: "公文查詢" },
      { href: "/announcements", iconKey: "announcement", label: "公告檢視" },
      { href: "/petitions/new", iconKey: "petition", label: "我要陳情" },
    ],
  },
];

function isSection(x: NavItem | NavSection): x is NavSection {
  return "heading" in x;
}

/* ── NavLink ──────────────────────────────────────────────────────────────── */
function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.end
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + "/");
  const Icon = Icons[item.iconKey];

  return (
    <Link
      href={item.href}
      className="sidebar-nav-item"
      aria-current={active ? "page" : undefined}>
      {Icon && <span className="flex-shrink-0"><Icon /></span>}
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  );
}

/* ── Sidebar ──────────────────────────────────────────────────────────────── */
export default function Sidebar() {
  const pathname = usePathname();
  const [userName, setUserName] = useState("使用者");
  const [userEmail, setUserEmail] = useState("");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setIsLoggedIn(!!userId);
    setUserName(localStorage.getItem("user_name") ?? "使用者");
    setUserEmail(localStorage.getItem("user_email") ?? "");
    setUserAvatar(localStorage.getItem("user_avatar"));
    setIsAdmin(localStorage.getItem("is_superuser") === "true");
    try {
      const raw = localStorage.getItem("permissions");
      if (raw) setPermissions(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }, []);

  const can = useMemo(
    () => (code: string) => {
      if (isAdmin) return true;
      if (permissions.has("admin:all")) return true;
      if (code === "audit:view_org" && (permissions.has("audit:view_all") || permissions.has("audit:view"))) {
        return true;
      }
      if (code.endsWith(":*")) {
        const prefix = code.slice(0, -1);
        return Array.from(permissions).some((p) => p.startsWith(prefix));
      }
      return permissions.has(code);
    },
    [isAdmin, permissions],
  );

  const sectionVisible = useMemo(
    () => (perm: string | undefined): boolean => {
      if (!perm) return true;
      if (isAdmin) return true;
      if (permissions.has("admin:all")) return true;
      if (perm.endsWith(":*")) {
        const prefix = perm.slice(0, -1);
        return Array.from(permissions).some((p) => p.startsWith(prefix));
      }
      return permissions.has(perm);
    },
    [isAdmin, permissions],
  );

  const navSections = useMemo(
    () =>
      (isLoggedIn ? NAV_DEF : NAV_DEF_LOGGED_OUT).map((entry) => {
        if (!isSection(entry)) return entry;
        if (!sectionVisible(entry.perm)) return null;
        const items = entry.items.filter((item) => {
          if (item.currentOnly && pathname !== item.href) return false;
          return !item.perm || can(item.perm);
        });
        return items.length > 0 ? { ...entry, items } : null;
      }).filter(Boolean) as (NavItem | NavSection)[],
    [can, isLoggedIn, pathname, sectionVisible],
  );

  const initials = userName.charAt(0).toUpperCase();

  return (
    <aside
      className="h-full flex flex-col overflow-hidden"
      style={{
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--sidebar-border)",
        width: "var(--sidebar-w, 240px)",
      }}
      aria-label="主選單">

      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-5 flex-shrink-0"
        style={{ height: "60px", borderBottom: "1px solid var(--sidebar-border)" }}>
        <Link href="/" className="flex items-center gap-3 min-w-0" aria-label="回到儀表板">
          {/* 金色徽章：宋體「自」字 */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base"
            style={{
              background: "linear-gradient(135deg, #c9a84c 0%, #b8962f 100%)",
              color: "#1a1a2e",
              fontFamily: "'Noto Serif TC', serif",
              fontWeight: 700,
              boxShadow: "0 2px 10px rgba(201,168,76,0.35)",
              letterSpacing: "0.02em",
            }}>
            自
          </div>
          <div className="min-w-0">
            <p
              className="text-sm leading-tight truncate"
              style={{
                color: "var(--sidebar-text-hover)",
                fontFamily: "'Noto Serif TC', serif",
                fontWeight: 600,
                letterSpacing: "0.06em",
              }}>
              校園自治平台
            </p>
            <p
              className="text-[10px] leading-tight mt-0.5 tracking-widest font-medium"
              style={{ color: "var(--primary)", opacity: 0.8 }}>
              HCCA
            </p>
          </div>
        </Link>
      </div>

      {/* ── Navigation ──────────────────────────────────────────────────── */}
      <nav
        className="flex-1 overflow-y-auto py-3 px-2"
        style={{ scrollbarWidth: "none" }}
        aria-label="主要導覽">
        <div className="space-y-0.5">
          {navSections.map((entry, i) => {
            if (!isSection(entry)) {
              return (
                <NavLink key={entry.href} item={entry} pathname={pathname} />
              );
            }
            return (
              <div key={i} className="pt-4 first:pt-0">
                <p className="sidebar-section-label px-3 mb-1.5">
                  {entry.heading}
                </p>
                <div className="space-y-0.5">
                  {entry.items.map((item) => (
                    <NavLink key={item.href} item={item} pathname={pathname} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </nav>

      {/* ── User Footer ─────────────────────────────────────────────────── */}
      <div
        className="px-2 py-3 flex-shrink-0"
        style={{ borderTop: "1px solid var(--sidebar-border)" }}>
        {isLoggedIn ? (
          <Link
            href="/profile"
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer"
            style={{ background: "transparent", textDecoration: "none", transition: "background var(--transition)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--sidebar-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            {userAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={userAvatar}
                alt={userName}
                className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                style={{ border: "1.5px solid var(--primary)", opacity: 0.92 }}
              />
            ) : (
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
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
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium truncate leading-tight"
                style={{ color: "var(--sidebar-text-hover)" }}>
                {userName}
              </p>
              <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--sidebar-text)" }}>
                {userEmail || "個人設定"}
              </p>
            </div>
            {isAdmin && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                style={{
                  background: "rgba(245,158,11,0.12)",
                  color: "var(--warning)",
                  border: "1px solid var(--warning-border)",
                }}>
                管理員
              </span>
            )}
          </Link>
        ) : (
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg w-full transition-colors"
            style={{
              background: "var(--primary-dim)",
              color: "var(--primary)",
              border: "1px solid var(--border-strong)",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            <span className="text-[13px] font-medium">登入系統</span>
          </Link>
        )}
      </div>
    </aside>
  );
}
