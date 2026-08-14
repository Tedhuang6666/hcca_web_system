"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogIn, MoreHorizontal } from "lucide-react";
import { useWS } from "@/hooks/useWS";
import { useInboxCountsContext } from "@/contexts/InboxCountsContext";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import { navigationProfilesApi } from "@/lib/api/navigation-profiles";
import { AUTH_CACHE_EVENT } from "@/lib/auth-cache";
import { NAV_ID_TO_MODULE, moduleForPath } from "@/lib/modules";
import {
  filterNavItems,
  constrainMobileHidden,
  hasSavedNavPreferences,
  isMeetingsUnlocked,
  isNavItemVisible,
  NAV_PREF_EVENT,
  navItemsFromEntries,
  NAVIGATION_PROFILES,
  NAV_ITEMS,
  navProfileFromApi,
  orderedItems,
  readNavPreferences,
  resolveNavigationProfile,
  type NavItem,
  type NavigationProfileConfig,
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
const LIQUID_DOCK_HEIGHT = 60;
const LIQUID_BEAD_RADIUS = 20;

interface DockMotion {
  x: number;
  velocity: number;
}

interface DockPointer {
  id: number;
  startX: number;
  moved: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function dockCenter(index: number, width: number, count: number) {
  return ((index + 0.5) / count) * width;
}

function dockIndexAt(x: number, width: number, count: number) {
  return clamp(Math.floor((x / width) * count), 0, count - 1);
}

function buildLiquidDockPath(width: number, height: number, beadX: number, velocity: number) {
  const inset = 10;
  const top = 14;
  const bottom = height - 3;
  const corner = 20;
  const speed = Math.min(Math.abs(velocity), 18);
  const notchWidth = LIQUID_BEAD_RADIUS * (1.45 + speed * 0.008);
  const notchDepth = 9 + speed * 0.32;
  const leftContact = clamp(beadX - notchWidth, inset + corner, width - inset - corner - 40);
  const rightContact = clamp(beadX + notchWidth, inset + corner + 40, width - inset - corner);
  const left = inset;
  const right = width - inset;

  return [
    `M ${left + corner} ${top}`,
    `H ${leftContact - 12}`,
    `C ${leftContact - 4} ${top}, ${leftContact - 7} ${top + notchDepth}, ${leftContact} ${top + notchDepth}`,
    `C ${leftContact + 11} ${top + notchDepth + 2}, ${beadX - 17} ${top + notchDepth * 0.22}, ${beadX} ${top + notchDepth * 0.18}`,
    `C ${beadX + 17} ${top + notchDepth * 0.22}, ${rightContact - 11} ${top + notchDepth + 2}, ${rightContact} ${top + notchDepth}`,
    `C ${rightContact + 7} ${top + notchDepth}, ${rightContact + 4} ${top}, ${rightContact + 12} ${top}`,
    `H ${right - corner}`,
    `Q ${right} ${top} ${right} ${top + corner}`,
    `V ${bottom - corner}`,
    `Q ${right} ${bottom} ${right - corner} ${bottom}`,
    `H ${left + corner}`,
    `Q ${left} ${bottom} ${left} ${bottom - corner}`,
    `V ${top + corner}`,
    `Q ${left} ${top} ${left + corner} ${top}`,
    "Z",
  ].join(" ");
}

/**
 * 平板與手機底部 tab bar（< lg 顯示）。
 * 依使用者身分顯示三套不同 tab：
 *  - guest：法規/公告/特約/陳情/登入（皆公開可讀）
 *  - student：依個人導覽偏好取前四個項目
 *  - teacher / mealVendor：依專屬視角取常用模組
 *  - cadre：首頁/待辦/公文/法規/更多（有公文、法規或審計權限者）
 */
export default function BottomTabBar({ onMoreClick }: BottomTabBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const dockRef = useRef<HTMLDivElement>(null);
  const targetXRef = useRef(0);
  const beadXRef = useRef(0);
  const velocityRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const hasInitialPositionRef = useRef(false);
  const pointerRef = useRef<DockPointer | null>(null);
  const suppressClickRef = useRef(false);
  const [dockWidth, setDockWidth] = useState(0);
  const [motion, setMotion] = useState<DockMotion>({ x: 0, velocity: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [role, setRole] = useState<Role>("guest");
  const [roleResolved, setRoleResolved] = useState(false);
  const [userRoom, setUserRoom] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [navPrefs, setNavPrefs] = useState(() => readNavPreferences());
  const [hasCustomNav, setHasCustomNav] = useState(false);
  const [meetingsUnlocked, setMeetingsUnlocked] = useState(false);
  const [serverProfile, setServerProfile] = useState<NavigationProfileConfig | null>(null);
  const [authVersion, setAuthVersion] = useState(0);
  const { isModuleClosed } = useModuleStatus();
  const {
    taskCount,
    unreadCount: notifCount,
    setUnreadCount: setNotifCount,
    refresh: refreshCounts,
  } = useInboxCountsContext();

  const wakeSpring = useCallback(() => {
    if (animationFrameRef.current !== null) return;

    const tick = () => {
      const distance = targetXRef.current - beadXRef.current;
      velocityRef.current = velocityRef.current * 0.78 + distance * 0.16;
      beadXRef.current += velocityRef.current;

      if (Math.abs(distance) < 0.08 && Math.abs(velocityRef.current) < 0.08) {
        beadXRef.current = targetXRef.current;
        velocityRef.current = 0;
        setMotion({ x: beadXRef.current, velocity: 0 });
        animationFrameRef.current = null;
        return;
      }

      setMotion({ x: beadXRef.current, velocity: velocityRef.current });
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncReducedMotion = () => setReducedMotion(media.matches);
    syncReducedMotion();
    media.addEventListener("change", syncReducedMotion);
    return () => media.removeEventListener("change", syncReducedMotion);
  }, []);

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
    const superuser = sessionStorage.getItem("is_superuser") === "true";
    const owner = sessionStorage.getItem("is_owner") === "true";
    let perms: string[] = [];
    try {
      const raw = sessionStorage.getItem("permissions");
      perms = raw ? JSON.parse(raw) : [];
    } catch { /* ignore */ }
    const isCadre =
      superuser
      || owner
      || perms.includes("admin:all")
      || perms.some((p) => CADRE_PREFIXES.some((pre) => p.startsWith(pre)));
    setRole(isCadre ? "cadre" : "student");
    setMeetingsUnlocked(isMeetingsUnlocked());
    setRoleResolved(true);
  }, [authVersion]);

  useEffect(() => {
    const syncAuth = () => setAuthVersion((version) => version + 1);
    window.addEventListener(AUTH_CACHE_EVENT, syncAuth);
    return () => window.removeEventListener(AUTH_CACHE_EVENT, syncAuth);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncPrefs = () => {
      setNavPrefs(readNavPreferences());
      setHasCustomNav(hasSavedNavPreferences());
      setMeetingsUnlocked(isMeetingsUnlocked());
    };
    syncPrefs();
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

  useEffect(() => {
    if (role === "guest") {
      setServerProfile(null);
      return;
    }
    let alive = true;
    navigationProfilesApi.me()
      .then((result) => {
        if (!alive) return;
        setServerProfile(
          result.source === "default" || !result.profile ? null : navProfileFromApi(result.profile),
        );
      })
      .catch(() => {
        if (alive) setServerProfile(null);
      });
    return () => {
      alive = false;
    };
  }, [authVersion, role]);

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
      sessionStorage.getItem("is_superuser") === "true" || sessionStorage.getItem("is_owner") === "true"
    );
    let perms = new Set<string>();
    try {
      perms = new Set(JSON.parse(sessionStorage.getItem("permissions") || "[]"));
    } catch { /* ignore */ }
    const can = (code: string) => superuser || perms.has("admin:all") || perms.has(code);
    const hasPrefix = (prefix: string) =>
      superuser || perms.has("admin:all") || Array.from(perms).some((perm) => perm.startsWith(prefix));
    const profile = resolveNavigationProfile(perms, superuser);
    const isAdmin = superuser || sessionStorage.getItem("is_owner") === "true";
    const activeProfile = isAdmin || perms.has("admin:all")
      ? NAVIGATION_PROFILES.default
      : serverProfile ?? NAVIGATION_PROFILES[profile];
    const profileItems = navItemsFromEntries(activeProfile.desktopSections);
    const profileItemIds = new Set([
      ...profileItems.map((item) => item.id),
      ...activeProfile.mobileOrder,
    ]);
    const profileNavItems = NAV_ITEMS.filter((item) => profileItemIds.has(item.id));
    const available = filterNavItems(
      profileNavItems,
      can,
      hasPrefix,
    );
    const isVisible = (item: NavItem) => isNavItemVisible(item, {
      can,
      hasPrefix,
      isAdmin,
      navigationProfile: activeProfile.id,
      meetingsUnlocked,
      isModuleClosed: (item) => isModuleClosed(NAV_ID_TO_MODULE[item.id] ?? null),
    });
    const visibleProfileItems = available.filter(isVisible);
    const defaultMobileItems = orderedItems(activeProfile.mobileOrder, [], visibleProfileItems);
    const mobileOrder = hasCustomNav ? navPrefs.mobileOrder : activeProfile.mobileOrder;
    const mobileHidden = hasCustomNav
      ? navPrefs.mobileHidden
      : defaultMobileItems.slice(4).map((item) => item.id);
    const constrainedHidden = constrainMobileHidden(mobileOrder, mobileHidden, visibleProfileItems);
    const topTabs = orderedItems(mobileOrder, constrainedHidden, profileNavItems)
      .filter(isVisible)
      .slice(0, 5)
      .map(navItemToTab);
    return [...topTabs, { label: "更多", icon: (p) => <MoreHorizontal {...p} />, onClick: onMoreClick }];
  }, [hasCustomNav, isModuleClosed, meetingsUnlocked, navPrefs, onMoreClick, role, serverProfile]);

  const activeIndex = useMemo(() => {
    const matchingIndex = tabs.findIndex((tab) => tab.match?.(pathname) ?? false);
    return matchingIndex >= 0 ? matchingIndex : tabs.length - 1;
  }, [pathname, tabs]);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const updateWidth = () => setDockWidth(dock.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [tabs.length]);

  useEffect(() => {
    if (!dockWidth || !tabs.length || activeIndex < 0) return;

    const nextX = dockCenter(activeIndex, dockWidth, tabs.length);
    targetXRef.current = nextX;
    if (!hasInitialPositionRef.current) {
      beadXRef.current = nextX;
      velocityRef.current = 0;
      setMotion({ x: nextX, velocity: 0 });
      hasInitialPositionRef.current = true;
      return;
    }
    if (reducedMotion) {
      beadXRef.current = nextX;
      velocityRef.current = 0;
      setMotion({ x: nextX, velocity: 0 });
      return;
    }
    wakeSpring();
  }, [activeIndex, dockWidth, reducedMotion, tabs.length, wakeSpring]);

  const dockPointFromEvent = useCallback((clientX: number) => {
    const dock = dockRef.current;
    if (!dock || !dockWidth) return null;
    const rect = dock.getBoundingClientRect();
    return clamp(clientX - rect.left, LIQUID_BEAD_RADIUS, dockWidth - LIQUID_BEAD_RADIUS);
  }, [dockWidth]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !tabs.length) return;
    const dock = dockRef.current;
    const point = dockPointFromEvent(event.clientX);
    if (!dock || point === null) return;
    const rect = dock.getBoundingClientRect();
    if (event.clientY < rect.top || event.clientY > rect.bottom) return;

    pointerRef.current = { id: event.pointerId, startX: event.clientX, moved: false };
    setDragging(true);
    setDragIndex(dockIndexAt(point, dockWidth, tabs.length));
    targetXRef.current = point;
    if (reducedMotion) {
      beadXRef.current = point;
      velocityRef.current = 0;
      setMotion({ x: point, velocity: 0 });
    } else {
      wakeSpring();
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [dockPointFromEvent, dockWidth, reducedMotion, tabs.length, wakeSpring]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    const point = dockPointFromEvent(event.clientX);
    if (point === null) return;
    if (Math.abs(event.clientX - pointer.startX) > 6) pointer.moved = true;
    if (!pointer.moved) return;

    event.preventDefault();
    setDragIndex(dockIndexAt(point, dockWidth, tabs.length));
    targetXRef.current = point;
    if (reducedMotion) {
      beadXRef.current = point;
      velocityRef.current = 0;
      setMotion({ x: point, velocity: 0 });
    } else {
      wakeSpring();
    }
  }, [dockPointFromEvent, dockWidth, reducedMotion, tabs.length, wakeSpring]);

  const finishPointer = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    const point = dockPointFromEvent(event.clientX);
    const selectedIndex = pointer.moved && point !== null
      ? dockIndexAt(point, dockWidth, tabs.length)
      : dragIndex ?? activeIndex;
    if (pointer.moved && selectedIndex >= 0 && selectedIndex < tabs.length) {
      event.preventDefault();
      suppressClickRef.current = true;
      const selectedTab = tabs[selectedIndex];
      if (selectedTab.href) router.push(selectedTab.href);
      else selectedTab.onClick?.();
    }
    pointerRef.current = null;
    setDragging(false);
    setDragIndex(null);
  }, [activeIndex, dockPointFromEvent, dockWidth, dragIndex, router, tabs]);

  const cancelPointer = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (pointerRef.current?.id !== event.pointerId) return;
    pointerRef.current = null;
    setDragging(false);
    setDragIndex(null);
  }, []);

  const handleItemClick = useCallback((event: React.MouseEvent<HTMLElement>, index: number) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
      return;
    }
    if (!dockWidth || !tabs.length) return;
    targetXRef.current = dockCenter(index, dockWidth, tabs.length);
    if (!reducedMotion) wakeSpring();
  }, [dockWidth, reducedMotion, tabs.length, wakeSpring]);

  const visualIndex = dragIndex ?? activeIndex;
  const beadScaleX = 1 + Math.min(Math.abs(motion.velocity) * 0.012, 0.16);
  const beadScaleY = 1 - Math.min(Math.abs(motion.velocity) * 0.004, 0.06);
  const dockPath = dockWidth > 0 && tabs.length > 0
    ? buildLiquidDockPath(dockWidth, LIQUID_DOCK_HEIGHT, motion.x, motion.velocity)
    : "";

  if (keyboardOpen) return null;
  if (!roleResolved) return null;

  return (
    <nav
      aria-label="底部主選單"
      className="bottom-tab-bar fixed bottom-0 left-0 right-0 z-30 flex lg:hidden"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      style={{
        height: "calc(72px + env(safe-area-inset-bottom))",
        boxSizing: "border-box",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingBottom: "env(safe-area-inset-bottom)",
        touchAction: "none",
        userSelect: "none",
      }}>
      <div
        ref={dockRef}
        className="relative flex h-[60px] w-[calc(100%-1.25rem)] overflow-visible"
        style={{
          isolation: "isolate",
          cursor: dragging ? "grabbing" : "grab",
          borderRadius: 22,
          background: "color-mix(in srgb, var(--bg-elevated) 74%, transparent)",
          backdropFilter: "blur(16px) saturate(1.2)",
          WebkitBackdropFilter: "blur(16px) saturate(1.2)",
        }}>
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          viewBox={`0 0 ${Math.max(dockWidth, 1)} ${LIQUID_DOCK_HEIGHT}`}
          preserveAspectRatio="none">
          <path
            d={dockPath}
            fill="var(--bg-elevated)"
            fillOpacity="0.9"
            stroke="var(--border)"
            strokeOpacity="0.82"
            strokeWidth="1" />
          <path
            d={dockPath}
            fill="none"
            stroke="color-mix(in srgb, var(--primary) 32%, transparent)"
            strokeLinecap="round"
            strokeWidth="1.5"
            opacity="0.72" />
        </svg>

        <span
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            left: motion.x,
            top: 14,
            zIndex: 1,
            width: LIQUID_BEAD_RADIUS * 2,
            height: LIQUID_BEAD_RADIUS * 2,
            borderRadius: "50%",
            background: "var(--primary)",
            boxShadow: "0 8px 18px color-mix(in srgb, var(--primary) 34%, transparent)",
            opacity: dockWidth ? 1 : 0,
            transform: `translate(-50%, -50%) scale(${beadScaleX}, ${beadScaleY})`,
            transformOrigin: "center",
            willChange: "transform, left",
          }} />

        {tabs.map((t, index) => {
          const active = t.match ? t.match(pathname) : false;
          const visualActive = visualIndex === index;
          const badge =
            t.badgeKey === "tasks" ? taskCount :
            t.badgeKey === "notifs" ? notifCount : 0;
        const Icon = t.icon;

          const inner = (
            <div className="relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full"
              style={{
                color: visualActive ? "var(--primary-fg)" : "var(--text-primary)",
                fontWeight: visualActive ? 650 : 500,
                transform: visualActive ? "translateY(-1px)" : undefined,
                transition: reducedMotion ? "none" : "color 180ms ease, transform 180ms ease",
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
            <span className="text-[11px] font-medium" style={{ letterSpacing: 0 }}>
              {t.label}
            </span>
          </div>
        );

        if (t.href) {
          return (
            <Link
              key={t.label}
              href={t.href}
              className="relative z-[2] flex min-h-[44px] flex-1"
              onClick={(event) => handleItemClick(event, index)}
              style={{ textDecoration: "none" }}
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
            onClick={(event) => {
              handleItemClick(event, index);
              if (!event.defaultPrevented) t.onClick?.();
            }}
            className="relative z-[2] flex min-h-[44px] flex-1 border-0 bg-transparent p-0"
            aria-label={t.label}>
            {inner}
          </button>
        );
      })}
      </div>
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
