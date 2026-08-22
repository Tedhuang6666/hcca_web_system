"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronDown, Globe2 } from "lucide-react";
import BrandEmblem from "@/components/brand/BrandEmblem";
import { usePermissions } from "@/hooks/usePermissions";
import { AUTH_CACHE_EVENT } from "@/lib/auth-cache";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import { BRANDING } from "@/lib/branding";
import { navigationProfilesApi } from "@/lib/api/navigation-profiles";
import { NAV_ID_TO_MODULE } from "@/lib/modules";
import NavIcon from "./NavIcon";
import {
  hasSavedNavPreferences,
  isMeetingsUnlocked,
  isNavItemVisible,
  DEFAULT_NAV_PREFERENCES,
  isSection,
  NAV_DEF_LOGGED_OUT,
  navProfileFromApi,
  NAV_PREF_EVENT,
  navDefinitionForProfile,
  orderedItems,
  readNavPreferences,
  resolveNavigationProfile,
  type NavEntry,
  type NavItem,
  type NavigationProfileConfig,
} from "@/lib/navigation";

/* ── 折疊狀態：localStorage 持久化 ─────────────────────────────────────── */
const COLLAPSED_KEY = "sidebar.collapsed-sections";
const NAV_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

function readCachedProfile(key: string): NavigationProfileConfig | null | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as { savedAt: number; profile: NavigationProfileConfig | null };
    if (!Number.isFinite(cached.savedAt) || Date.now() - cached.savedAt > NAV_PROFILE_CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return undefined;
    }
    return cached.profile;
  } catch {
    return undefined;
  }
}

function writeCachedProfile(key: string, profile: NavigationProfileConfig | null) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), profile }));
  } catch {
    /* storage may be unavailable */
  }
}

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
  const href = item.id === "about" || item.id === "publicAbout" ? "/system-info" : item.href;
  const active = item.end
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className="sidebar-nav-item motion-nav-link"
      aria-current={active ? "page" : undefined}>
      <span className="flex-shrink-0"><NavIcon iconKey={item.iconKey} size={15} /></span>
      <span className="flex-1 truncate">{item.label}</span>
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

function SidebarNavSkeleton() {
  const groups = [4, 7, 5];

  return (
    <div className="space-y-4 px-1" role="status" aria-label="正在載入導覽">
      <span className="sr-only">正在載入導覽</span>
      {groups.map((itemCount, groupIndex) => (
        <div key={groupIndex} className="space-y-1.5" aria-hidden="true">
          <div className="mx-3 h-3 w-16 rounded" style={{ background: "var(--sidebar-hover)" }} />
          {Array.from({ length: itemCount }, (_, itemIndex) => (
            <div key={itemIndex} className="flex h-8 items-center gap-2.5 px-3">
              <div className="h-4 w-4 flex-shrink-0 rounded" style={{ background: "var(--sidebar-hover)" }} />
              <div
                className="h-3 rounded"
                style={{
                  width: `${56 + ((groupIndex + itemIndex) % 4) * 12}px`,
                  background: "var(--sidebar-hover)",
                }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Sidebar ──────────────────────────────────────────────────────────────── */
export default function Sidebar() {
  const pathname = usePathname();
  const { can, isAdmin, permissions } = usePermissions();
  const { isModuleDown, isModuleClosed } = useModuleStatus();
  const [userName, setUserName] = useState("使用者");
  const [userEmail, setUserEmail] = useState("");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [desktopPrefs, setDesktopPrefs] = useState(() => DEFAULT_NAV_PREFERENCES);
  const [hasCustomNav, setHasCustomNav] = useState(false);
  const [meetingsUnlocked, setMeetingsUnlocked] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [serverProfile, setServerProfile] = useState<NavigationProfileConfig | null>(null);
  const [publicProfile, setPublicProfile] = useState<NavigationProfileConfig | null>(null);
  const [authVersion, setAuthVersion] = useState(0);
  const navigationProfile = useMemo(
    () => resolveNavigationProfile(permissions, isAdmin),
    [isAdmin, permissions],
  );
  const activeNavDef = useMemo(
    () => {
      if (!isLoggedIn) return publicProfile?.desktopSections ?? NAV_DEF_LOGGED_OUT;
      // 管理員必須保留完整後台入口；自訂視角只套用到一般使用者。
      if (isAdmin || permissions.has("admin:all")) return navDefinitionForProfile("default");
      return serverProfile?.desktopSections ?? navDefinitionForProfile(navigationProfile);
    },
    [isAdmin, isLoggedIn, navigationProfile, permissions, publicProfile, serverProfile],
  );

  useEffect(() => {
    if (!hydrated) return;

    let alive = true;
    if (!isLoggedIn) {
      setServerProfile(null);
      navigationProfilesApi.public("public")
        .then((profile) => {
          if (!alive) return;
          setPublicProfile(navProfileFromApi(profile));
        })
        .catch(() => {
          if (!alive) return;
          setPublicProfile(null);
        });
      return () => {
        alive = false;
      };
    }
    setPublicProfile(null);
    const cacheKey = `hcca:navigation-profile:${localStorage.getItem("user_id") ?? "anonymous"}`;
    const cached = readCachedProfile(cacheKey);
    if (cached !== undefined) {
      setServerProfile(cached);
      return () => {
        alive = false;
      };
    }
    navigationProfilesApi.me()
      .then((result) => {
        if (!alive) return;
        const profile = result.source === "default" || !result.profile
          ? null
          : navProfileFromApi(result.profile);
        setServerProfile(profile);
        writeCachedProfile(cacheKey, profile);
      })
      .catch(() => {
        if (!alive) return;
        setServerProfile(null);
      });
    return () => {
      alive = false;
    };
  }, [authVersion, hydrated, isLoggedIn]);

  // 初始化：讀 localStorage、設定 event listener，僅在 mount 時執行一次
  useEffect(() => {
    const syncAuth = () => {
      const userId = localStorage.getItem("user_id");
      setIsLoggedIn(!!userId);
      setUserName(localStorage.getItem("user_name") ?? "使用者");
      setUserEmail(localStorage.getItem("user_email") ?? "");
      setUserAvatar(localStorage.getItem("user_avatar"));
      setDesktopPrefs(readNavPreferences());
      setHasCustomNav(hasSavedNavPreferences());
      setMeetingsUnlocked(isMeetingsUnlocked());
      setAuthVersion((version) => version + 1);
    };
    syncAuth();

    const persisted = readCollapsed();
    setCollapsed(new Set(persisted));
    setHydrated(true);

    const syncPrefs = () => {
      setDesktopPrefs(readNavPreferences());
      setHasCustomNav(hasSavedNavPreferences());
      setMeetingsUnlocked(isMeetingsUnlocked());
    };
    window.addEventListener(NAV_PREF_EVENT, syncPrefs);
    window.addEventListener(AUTH_CACHE_EVENT, syncAuth);
    window.addEventListener("storage", syncPrefs);
    return () => {
      window.removeEventListener(NAV_PREF_EVENT, syncPrefs);
      window.removeEventListener(AUTH_CACHE_EVENT, syncAuth);
      window.removeEventListener("storage", syncPrefs);
    };
    // This is mount-only initialization. Profile changes are handled by the
    // activeNavDef effect below and must not re-run auth/profile requests.
  }, []);

  // 切頁時自動展開當前路徑所在分組（不寫 localStorage、不覆蓋手動設定）
  useEffect(() => {
    setCollapsed((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const entry of activeNavDef) {
        if (isSection(entry) && next.has(entry.heading)) {
          if (entry.items.some(
            (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
          )) {
            next.delete(entry.heading);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [activeNavDef, pathname]);

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

  useEffect(() => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const entry of activeNavDef) {
        if (isSection(entry) && entry.collapsible && entry.defaultCollapsed) {
          next.add(entry.heading);
        }
      }
      return next;
    });
  }, [activeNavDef]);

  const itemVisible = (item: NavItem): boolean => {
    return isNavItemVisible(item, {
      can,
      hasPrefix,
      isAdmin,
      navigationProfile,
      meetingsUnlocked,
      isModuleClosed: (current) => isModuleClosed(NAV_ID_TO_MODULE[current.id] ?? null),
    });
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
        return activeNavDef.map((entry) => {
          if (!isSection(entry)) return visibleItems.has(entry.id) ? entry : null;
          const items = entry.items
            .filter((item) => visibleItems.has(item.id))
            .sort((a, b) => (orderIndex.get(a.id) ?? 9999) - (orderIndex.get(b.id) ?? 9999));
          return items.length > 0 ? { ...entry, items } : null;
        }).filter(Boolean) as NavEntry[];
      }
      return activeNavDef.map((entry) => {
        if (!isSection(entry)) return entry;
        const items = entry.items.filter(itemVisible);
        return items.length > 0 ? { ...entry, items } : null;
      }).filter(Boolean) as NavEntry[];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      desktopPrefs,
      hasCustomNav,
      hydrated,
      isLoggedIn,
      isAdmin,
      permissions,
      meetingsUnlocked,
      isModuleClosed,
      activeNavDef,
    ],
  );

  // 本機已保存的登入身分、權限與預設視角足以安全繪製導覽；個人化設定僅在
  // 回應抵達後覆寫。不可讓一個非關鍵的設定請求阻塞整個側欄。
  const navigationReady = hydrated;

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
          <BrandEmblem size={40} priority />
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
        aria-label="主要導覽"
        aria-busy={!navigationReady}>
        {!navigationReady ? (
          <SidebarNavSkeleton />
        ) : (
          <>
            <Link
              href="/"
              className="sidebar-public-entry"
              aria-label="返回公開網站">
              <Globe2 size={15} aria-hidden={true} />
              <span className="flex-1 truncate">返回公開頁</span>
            </Link>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("hcca:open-command-menu"))}
                className="sidebar-nav-item motion-nav-link w-full text-left"
                style={{ background: "var(--sidebar-hover)", color: "var(--sidebar-text-hover)" }}
                aria-label="開啟所有功能">
                <span className="flex-shrink-0"><NavIcon iconKey="modules" size={15} /></span>
                <span className="flex-1 truncate">所有功能</span>
              </button>
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
                const isCollapsed = collapsed.has(entry.heading);
                const sectionId = `nav-section-${i}`;
                return (
                  <div key={entry.heading + i} className="sidebar-section pt-4 first:pt-0">
                    {entry.collapsible ? (
                      <button
                        type="button"
                        onClick={() => toggleSection(entry.heading)}
                        className="sidebar-section-toggle"
                        aria-expanded={!isCollapsed}
                        aria-controls={sectionId}>
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
                      <p className="sidebar-section-label px-3 pb-1">{entry.heading}</p>
                    )}
                    {!isCollapsed && (
                      <div id={sectionId} className="sidebar-section-content space-y-0.5">
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
          </>
        )}
      </nav>

      {/* User footer */}
      <div
        className="px-2 py-3 flex-shrink-0"
        style={{ borderTop: "1px solid var(--sidebar-border)" }}>
        {isLoggedIn ? (
          <Link
            href="/settings/account"
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
