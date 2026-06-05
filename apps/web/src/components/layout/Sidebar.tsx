"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import { BRANDING } from "@/lib/branding";
import { NAV_ID_TO_MODULE } from "@/lib/modules";
import NavIcon from "./NavIcon";
import {
  filterNavItems,
  hasSavedNavPreferences,
  isMeetingsUnlocked,
  isSection,
  NAV_DEF,
  NAV_DEF_LOGGED_OUT,
  NAV_PREF_EVENT,
  orderedItems,
  readNavPreferences,
  type NavEntry,
  type NavItem,
} from "@/lib/navigation";

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
function NavLink({ item, pathname, down }: { item: NavItem; pathname: string; down?: boolean }) {
  const active = item.end
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + "/");
  const isGovernanceHub = item.id === "governanceHub";

  return (
    <Link
      href={item.href}
      className={`sidebar-nav-item ${isGovernanceHub ? "min-h-12" : ""}`}
      style={
        isGovernanceHub
          ? {
              background: active ? "var(--sidebar-active)" : "rgba(201,168,76,0.07)",
              border: "1px solid rgba(201,168,76,0.2)",
            }
          : undefined
      }
      aria-current={active ? "page" : undefined}>
      <span className="flex-shrink-0"><NavIcon iconKey={item.iconKey} size={15} /></span>
      {isGovernanceHub ? (
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{item.label}</span>
          <span className="mt-0.5 block truncate text-[10px]" style={{ color: "var(--sidebar-section-label)" }}>
            事情、案件與流程
          </span>
        </span>
      ) : (
        <span className="flex-1 truncate">{item.label}</span>
      )}
      {down && (
        <span
          className="ml-1 flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            background: "var(--warning-dim)",
            color: "var(--warning)",
            border: "1px solid var(--warning-border)",
          }}
          title="此模組維護中">
          維護中
        </span>
      )}
    </Link>
  );
}

/* ── Sidebar ──────────────────────────────────────────────────────────────── */
export default function Sidebar() {
  const pathname = usePathname();
  const { can, isAdmin, permissions } = usePermissions();
  const { isModuleDown } = useModuleStatus();
  const [userName, setUserName] = useState("使用者");
  const [userEmail, setUserEmail] = useState("");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [desktopPrefs, setDesktopPrefs] = useState(() => readNavPreferences());
  const [hasCustomNav, setHasCustomNav] = useState(false);
  const [meetingsUnlocked, setMeetingsUnlocked] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setIsLoggedIn(!!userId);
    setUserName(localStorage.getItem("user_name") ?? "使用者");
    setUserEmail(localStorage.getItem("user_email") ?? "");
    setUserAvatar(localStorage.getItem("user_avatar"));
    setHasCustomNav(hasSavedNavPreferences());
    setMeetingsUnlocked(isMeetingsUnlocked());

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

    const syncPrefs = () => {
      setDesktopPrefs(readNavPreferences());
      setHasCustomNav(hasSavedNavPreferences());
      setMeetingsUnlocked(isMeetingsUnlocked());
    };
    window.addEventListener(NAV_PREF_EVENT, syncPrefs);
    window.addEventListener("storage", syncPrefs);
    return () => {
      window.removeEventListener(NAV_PREF_EVENT, syncPrefs);
      window.removeEventListener("storage", syncPrefs);
    };
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
    if (item.id === "systemDefense" && !isAdmin) return false;
    // 議事系統：會議管理者（meeting:*）與管理員一律可見；
    // 一般使用者需掃描現場簽到連結解鎖後才顯示。
    if (item.id === "meetings") return meetingsUnlocked || hasPrefix("meeting:");
    return filterNavItems([item], can, hasPrefix).length > 0;
  };

  const navSections = useMemo(
    () => {
      if (isLoggedIn && hydrated && hasCustomNav) {
        const visibleItems = new Set(
          orderedItems(desktopPrefs.desktopOrder, desktopPrefs.desktopHidden)
            .filter(itemVisible)
            .map((item) => item.id),
        );
        const orderIndex = new Map(desktopPrefs.desktopOrder.map((id, index) => [id, index]));
        return NAV_DEF.map((entry) => {
          if (!isSection(entry)) return visibleItems.has(entry.id) ? entry : null;
          const items = entry.items
            .filter((item) => visibleItems.has(item.id))
            .sort((a, b) => (orderIndex.get(a.id) ?? 9999) - (orderIndex.get(b.id) ?? 9999));
          return items.length > 0 ? { ...entry, items } : null;
        }).filter(Boolean) as NavEntry[];
      }
      return (isLoggedIn ? NAV_DEF : NAV_DEF_LOGGED_OUT).map((entry) => {
        if (!isSection(entry)) return entry;
        const items = entry.items.filter(itemVisible);
        return items.length > 0 ? { ...entry, items } : null;
      }).filter(Boolean) as NavEntry[];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [desktopPrefs, hasCustomNav, hydrated, isLoggedIn, isAdmin, permissions, meetingsUnlocked],
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
            {BRANDING.acronym}
          </div>
          <div className="min-w-0">
            <p
              className="text-sm leading-tight truncate"
              style={{ color: "var(--sidebar-text-hover)", fontWeight: 600, letterSpacing: 0 }}>
              {BRANDING.orgShortName}
            </p>
            <p
              className="text-[10px] leading-tight mt-0.5 tracking-widest font-medium"
              style={{ color: "var(--primary-text)" }}>
              {BRANDING.acronym}
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
              return (
                <NavLink
                  key={entry.href}
                  item={entry}
                  pathname={pathname}
                  down={isModuleDown(NAV_ID_TO_MODULE[entry.id] ?? null)}
                />
              );
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
                      <NavLink
                        key={item.href}
                        item={item}
                        pathname={pathname}
                        down={isModuleDown(NAV_ID_TO_MODULE[item.id] ?? null)}
                      />
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
              <Image
                src={userAvatar}
                alt={userName}
                width={28}
                height={28}
                unoptimized
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
              color: "var(--primary-text)",
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
