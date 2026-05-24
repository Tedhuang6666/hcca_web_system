"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  FileText,
  Files,
  BookOpen,
  Barcode,
  ShoppingCart,
  Warehouse,
  CheckSquare,
  MessageCircle,
  MessageSquare,
  Mail,
  Lock,
  ClipboardList,
  Network,
  Landmark,
  Utensils,
  Store,
  Users,
  BarChart3,
  MapPinned,
  ChevronDown,
  Inbox,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

/* ── Lucide Icons ─────────────────────────────────────────────────────────── */
const Icons: Record<string, React.ComponentType<{ size: number; "aria-hidden": boolean }>> = {
  dashboard:         (p) => <LayoutGrid {...p} />,
  documents:         (p) => <FileText {...p} />,
  documentTemplates: (p) => <Files {...p} />,
  regulations:       (p) => <BookOpen {...p} />,
  meetings:          (p) => <Landmark {...p} />,
  serial:            (p) => <Barcode {...p} />,
  shop:              (p) => <ShoppingCart {...p} />,
  shopAdmin:         (p) => <Warehouse {...p} />,
  shopOrders:        (p) => <Store {...p} />,
  meal:              (p) => <Utensils {...p} />,
  mealVendor:        (p) => <Utensils {...p} />,
  survey:            (p) => <CheckSquare {...p} />,
  announcement:      (p) => <MessageCircle {...p} />,
  petition:          (p) => <MessageSquare {...p} />,
  email:             (p) => <Mail {...p} />,
  permissions:       (p) => <Lock {...p} />,
  audit:             (p) => <ClipboardList {...p} />,
  org:               (p) => <Network {...p} />,
  classes:           (p) => <Users {...p} />,
  analytics:         (p) => <BarChart3 {...p} />,
  partnerMap:        (p) => <MapPinned {...p} />,
  tasks:             (p) => <Inbox {...p} />,
};

/* ── 導覽資料結構 ────────────────────────────────────────────────────────── */
type NavItem = {
  href: string;
  iconKey: string;
  label: string;
  end?: boolean;
  perm?: string;   // 單一權限代碼或前綴匹配（"foo:*"）
};
type NavSection = {
  heading: string;
  items: NavItem[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
};

const NAV_DEF: (NavItem | NavSection)[] = [
  { href: "/", iconKey: "dashboard", label: "儀表板", end: true },
  { href: "/tasks", iconKey: "tasks", label: "我的待辦" },

  {
    heading: "議事",
    items: [
      { href: "/documents",   iconKey: "documents",   label: "公文系統" },
      { href: "/meetings",    iconKey: "meetings",    label: "議事系統" },
      { href: "/regulations", iconKey: "regulations", label: "法規查詢" },
    ],
  },

  {
    heading: "社群與服務",
    items: [
      { href: "/announcements",     iconKey: "announcement", label: "公告" },
      { href: "/shop",              iconKey: "shop",         label: "校商訂購" },
      { href: "/shop/class-orders", iconKey: "shopOrders",   label: "班級訂單", perm: "class:shop_collect" },
      { href: "/meal",              iconKey: "meal",         label: "學餐訂購" },
      { href: "/partner-map",       iconKey: "partnerMap",   label: "特約地圖" },
      { href: "/surveys",           iconKey: "survey",       label: "問卷" },
      { href: "/petitions",         iconKey: "petition",     label: "陳情" },
    ],
  },

  {
    heading: "管理",
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { href: "/analytics",          iconKey: "analytics",         label: "績效統計",   perm: "analytics:view" },
      { href: "/orgs",               iconKey: "org",               label: "組織管理",   perm: "org:*" },
      { href: "/admin/permissions",  iconKey: "permissions",       label: "權限管理",   perm: "admin:all" },
      { href: "/admin/classes",      iconKey: "classes",           label: "班級管理",   perm: "class:manage" },
      { href: "/audit-logs",         iconKey: "audit",             label: "稽核日誌",   perm: "audit:view_org" },
      { href: "/document-templates", iconKey: "documentTemplates", label: "公文範本",   perm: "document:create" },
      { href: "/serial-templates",   iconKey: "serial",            label: "字號模板",   perm: "serial:create" },
      { href: "/email",              iconKey: "email",             label: "電子郵件",   perm: "email:*" },
      { href: "/shop/admin",         iconKey: "shopAdmin",         label: "校商後台",   perm: "shop:manage" },
      { href: "/meal/vendor",        iconKey: "mealVendor",        label: "商家管理",   perm: "meal:manage" },
      { href: "/partner-map/admin",  iconKey: "partnerMap",        label: "特約管理",   perm: "partner_map:manage" },
      { href: "/petitions/manage",   iconKey: "petition",          label: "陳情管理",   perm: "petition:*" },
    ],
  },
];

const NAV_DEF_LOGGED_OUT: (NavItem | NavSection)[] = [
  {
    heading: "公開",
    items: [
      { href: "/regulations",   iconKey: "regulations",   label: "法規查詢" },
      { href: "/documents",     iconKey: "documents",     label: "公文查詢" },
      { href: "/announcements", iconKey: "announcement",  label: "公告" },
      { href: "/partner-map",   iconKey: "partnerMap",    label: "特約地圖" },
      { href: "/petitions/new", iconKey: "petition",      label: "我要陳情" },
    ],
  },
];

function isSection(x: NavItem | NavSection): x is NavSection {
  return "heading" in x;
}

/* ── 折疊狀態：localStorage 持久化 ─────────────────────────────────────── */
const COLLAPSED_KEY = "sidebar.collapsed-sections";

function readCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* quota / serialization — silently ignore */
  }
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
  const { can, isAdmin, permissions } = usePermissions();
  const [userName, setUserName] = useState("使用者");
  const [userEmail, setUserEmail] = useState("");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setIsLoggedIn(!!userId);
    setUserName(localStorage.getItem("user_name") ?? "使用者");
    setUserEmail(localStorage.getItem("user_email") ?? "");
    setUserAvatar(localStorage.getItem("user_avatar"));

    const persisted = readCollapsed();
    if (persisted.size === 0) {
      const defaults = new Set<string>();
      for (const entry of NAV_DEF) {
        if (isSection(entry) && entry.collapsible && entry.defaultCollapsed) {
          defaults.add(entry.heading);
        }
      }
      setCollapsed(defaults);
    } else {
      setCollapsed(persisted);
    }
    setHydrated(true);
  }, []);

  const toggleSection = (heading: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(heading)) next.delete(heading);
      else next.add(heading);
      writeCollapsed(next);
      return next;
    });
  };

  const hasPrefix = useMemo(() => {
    return (prefix: string): boolean => {
      if (isAdmin) return true;
      if (permissions.has("admin:all")) return true;
      for (const p of permissions) {
        if (p.startsWith(prefix)) return true;
      }
      return false;
    };
  }, [isAdmin, permissions]);

  const itemVisible = (item: NavItem): boolean => {
    if (!item.perm) return true;
    if (item.perm.endsWith(":*")) return hasPrefix(item.perm.slice(0, -1));
    return can(item.perm);
  };

  const navSections = useMemo(
    () =>
      (isLoggedIn ? NAV_DEF : NAV_DEF_LOGGED_OUT).map((entry) => {
        if (!isSection(entry)) return entry;
        const items = entry.items.filter(itemVisible);
        return items.length > 0 ? { ...entry, items } : null;
      }).filter(Boolean) as (NavItem | NavSection)[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLoggedIn, isAdmin, permissions],
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

      {/* Logo */}
      <div
        className="flex items-center gap-3 px-5 flex-shrink-0"
        style={{ height: "60px", borderBottom: "1px solid var(--sidebar-border)" }}>
        <Link href="/" className="flex items-center gap-3 min-w-0" aria-label="回到儀表板">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base"
            style={{
              background: "linear-gradient(135deg, #c9a84c 0%, #b8962f 100%)",
              color: "#1a1a2e",
              fontWeight: 700,
              boxShadow: "0 2px 10px rgba(201,168,76,0.35)",
              letterSpacing: "0.02em",
            }}>
            自
          </div>
          <div className="min-w-0">
            <p
              className="text-sm leading-tight truncate"
              style={{ color: "var(--sidebar-text-hover)", fontWeight: 600, letterSpacing: 0 }}>
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

      {/* Navigation */}
      <nav
        className="flex-1 overflow-y-auto py-3 px-2"
        style={{ scrollbarWidth: "none" }}
        aria-label="主要導覽">
        <div className="space-y-0.5">
          {navSections.map((entry, i) => {
            if (!isSection(entry)) {
              return <NavLink key={entry.href} item={entry} pathname={pathname} />;
            }
            const isCollapsed = hydrated && collapsed.has(entry.heading);
            const sectionId = `nav-section-${i}`;
            return (
              <div key={entry.heading + i} className="pt-4 first:pt-0">
                {entry.collapsible ? (
                  <button
                    type="button"
                    onClick={() => toggleSection(entry.heading)}
                    className="w-full flex items-center justify-between px-3 mb-1.5 cursor-pointer"
                    aria-expanded={!isCollapsed}
                    aria-controls={sectionId}
                    style={{ background: "transparent", border: "none" }}>
                    <span className="sidebar-section-label">{entry.heading}</span>
                    <ChevronDown
                      size={12}
                      aria-hidden={true}
                      style={{
                        color: "var(--sidebar-section-label)",
                        transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                        transition: "transform 150ms",
                      }}
                    />
                  </button>
                ) : (
                  <p className="sidebar-section-label px-3 mb-1.5">{entry.heading}</p>
                )}
                {!isCollapsed && (
                  <div id={sectionId} className="space-y-0.5">
                    {entry.items.map((item) => (
                      <NavLink key={item.href} item={item} pathname={pathname} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      {/* User footer */}
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
