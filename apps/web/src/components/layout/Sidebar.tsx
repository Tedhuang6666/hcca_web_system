"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  FileText,
  FilePlus,
  BookOpen,
  PenTool,
  Barcode,
  ShoppingCart,
  Warehouse,
  CheckSquare,
  MessageCircle,
  MessageSquare,
  Bell,
  Lock,
  ClipboardList,
  Network,
  User,
  ChevronRight,
} from "lucide-react";

/* ── Lucide React Icons ───────────────────────────────────────────────────────────── */
const Icons: Record<string, React.ComponentType<{ size: number; "aria-hidden": boolean }>> = {
  dashboard: ({ size, "aria-hidden": ariaHidden }) => <LayoutGrid size={size} aria-hidden={ariaHidden} />,
  documents: ({ size, "aria-hidden": ariaHidden }) => <FileText size={size} aria-hidden={ariaHidden} />,
  documentNew: ({ size, "aria-hidden": ariaHidden }) => <FilePlus size={size} aria-hidden={ariaHidden} />,
  regulations: ({ size, "aria-hidden": ariaHidden }) => <BookOpen size={size} aria-hidden={ariaHidden} />,
  regulationNew: ({ size, "aria-hidden": ariaHidden }) => <PenTool size={size} aria-hidden={ariaHidden} />,
  serial: ({ size, "aria-hidden": ariaHidden }) => <Barcode size={size} aria-hidden={ariaHidden} />,
  shop: ({ size, "aria-hidden": ariaHidden }) => <ShoppingCart size={size} aria-hidden={ariaHidden} />,
  shopAdmin: ({ size, "aria-hidden": ariaHidden }) => <Warehouse size={size} aria-hidden={ariaHidden} />,
  survey: ({ size, "aria-hidden": ariaHidden }) => <CheckSquare size={size} aria-hidden={ariaHidden} />,
  surveyNew: ({ size, "aria-hidden": ariaHidden }) => <PenTool size={size} aria-hidden={ariaHidden} />,
  meal: ({ size, "aria-hidden": ariaHidden }) => <ShoppingCart size={size} aria-hidden={ariaHidden} />,
  mealVendor: ({ size, "aria-hidden": ariaHidden }) => <MessageCircle size={size} aria-hidden={ariaHidden} />,
  announcement: ({ size, "aria-hidden": ariaHidden }) => <MessageCircle size={size} aria-hidden={ariaHidden} />,
  petition: ({ size, "aria-hidden": ariaHidden }) => <MessageSquare size={size} aria-hidden={ariaHidden} />,
  notifications: ({ size, "aria-hidden": ariaHidden }) => <Bell size={size} aria-hidden={ariaHidden} />,
  permissions: ({ size, "aria-hidden": ariaHidden }) => <Lock size={size} aria-hidden={ariaHidden} />,
  audit: ({ size, "aria-hidden": ariaHidden }) => <ClipboardList size={size} aria-hidden={ariaHidden} />,
  org: ({ size, "aria-hidden": ariaHidden }) => <Network size={size} aria-hidden={ariaHidden} />,
  profile: ({ size, "aria-hidden": ariaHidden }) => <User size={size} aria-hidden={ariaHidden} />,
  chevronRight: ({ size, "aria-hidden": ariaHidden }) => <ChevronRight size={size} aria-hidden={ariaHidden} />,
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
      { href: "/notifications", iconKey: "notifications", label: "通知中心" },
      { href: "/settings/security", iconKey: "permissions", label: "安全設定" },
      { href: "/settings/notifications", iconKey: "notifications", label: "通知設定" },
    ],
  },
  {
    heading: "管理",
    items: [
      { href: "/analytics",         iconKey: "dashboard",   label: "績效統計", perm: "analytics:view" },
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
      {Icon && <span className="flex-shrink-0"><Icon size={15} aria-hidden={true} /></span>}
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
