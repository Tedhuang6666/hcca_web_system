"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { PermissionProvider } from "@/contexts/PermissionContext";
import { InboxCountsProvider } from "@/contexts/InboxCountsContext";
import { ModuleStatusProvider, useModuleStatus } from "@/contexts/ModuleStatusContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useInboxCounts } from "@/hooks/useInboxCounts";
import { moduleForPath } from "@/lib/modules";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import BottomTabBar from "./BottomTabBar";
import PageTransition from "./PageTransition";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { LoadingState } from "@/components/ui/LoadingState";
import ModuleMaintenance from "@/components/ui/ModuleMaintenance";
import UrgentAnnouncementPopup from "@/components/announcements/UrgentAnnouncementPopup";
const CommandMenu = dynamic(() => import("./CommandMenu"), { ssr: false });
import { PolicyConsentBanner } from "@/components/legal/PolicyConsentBanner";
import { isPublicRoute, requiresAuthentication } from "@/lib/route-access";
import { authApi } from "@/lib/api";
import { cacheCurrentUser, clearAuthCache } from "@/lib/auth-cache";

/** 完全裸頁（不渲染 Shell）：公開官網、login、auth callback、Email 退訂落地頁 */
const BARE_PATHS = [
  "/",
  "/about",
  "/links",
  "/news",
  "/officers",
  "/pages",
  "/login",
  "/auth",
  "/maintenance",
  "/profile/complete",
  "/public",
  "/live",
  "/unsubscribe",
];

function isBare(pathname: string) {
  return BARE_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function SessionGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const redirectedFrom = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loggedIn = Boolean(localStorage.getItem("user_id"));

    if (!requiresAuthentication(pathname)) {
      setIsLoggedIn(loggedIn);
      setRedirecting(false);
      setAuthReady(true);
      return () => {
        cancelled = true;
      };
    }

    setAuthReady(false);
    const verifySession = async () => {
      if (!loggedIn) {
        if (cancelled) return;
        setRedirecting(true);
        setAuthReady(true);
        if (redirectedFrom.current !== pathname) {
          redirectedFrom.current = pathname;
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        }
        return;
      }

      try {
        const me = await authApi.me();
        if (cancelled) return;
        cacheCurrentUser(me);
        setIsLoggedIn(true);
        redirectedFrom.current = null;
        setRedirecting(false);
        setAuthReady(true);
      } catch {
        if (cancelled) return;
        clearAuthCache();
        setIsLoggedIn(false);
        setRedirecting(true);
        setAuthReady(true);
        if (redirectedFrom.current !== pathname) {
          redirectedFrom.current = pathname;
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        }
      }
    };

    void verifySession();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (!authReady || redirecting) {
    return (
      <div className="app-content-loading" aria-live="polite">
        <LoadingState
          title={redirecting ? "正在前往登入頁" : "正在確認登入狀態"}
          description="系統正在確認身分與頁面權限。"
        />
      </div>
    );
  }

  return (
    <ModuleStatusProvider authenticated={isLoggedIn}>
      <AppShellContent isLoggedIn={isLoggedIn}>{children}</AppShellContent>
    </ModuleStatusProvider>
  );
}

function AppShellContent({
  children,
  isLoggedIn,
}: {
  children: React.ReactNode;
  isLoggedIn: boolean;
}) {
  const { can, isAdmin } = usePermissions();
  const { isModuleDown, moduleInfo: getModuleInfo } = useModuleStatus();
  const pathname = usePathname();
  const moduleId = moduleForPath(pathname);
  const moduleDown = isModuleDown(moduleId);
  const moduleInfo = getModuleInfo(moduleId);
  const suppressPolicyConsent = pathname.startsWith("/legal");
  const inboxCounts = useInboxCounts(isLoggedIn);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);

  // 路由變更時自動關閉行動版側邊欄
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const toggleSidebar = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setDesktopSidebarOpen((open) => !open);
      return;
    }
    setSidebarOpen((open) => !open);
  };

  return (
    <PermissionProvider can={can}>
      <InboxCountsProvider value={inboxCounts}>
      <ConfirmProvider>
      <div className="app-shell flex h-screen overflow-hidden">
        <a
          href="#main-content"
          className="fixed left-3 top-3 z-[200] -translate-y-20 rounded-md px-3 py-2 text-sm font-medium transition-transform focus:translate-y-0"
          style={{ background: "var(--primary)", color: "#fff" }}
        >
          跳至主要內容
        </a>
        {/* 平板與行動版側邊欄遮罩 */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            style={{ background: "var(--bg-overlay)" }}
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* 側邊欄 */}
        <div
          className={`
            fixed inset-y-0 left-0 z-50 transition-transform duration-300
            lg:relative lg:z-auto
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
            ${desktopSidebarOpen ? "lg:block lg:translate-x-0" : "lg:hidden"}
          `}
          style={{ width: "var(--sidebar-w, 240px)" }}>
          <Sidebar />
        </div>

        {/* 主內容區 */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <Topbar onMenuClick={toggleSidebar} />
          <main
            id="main-content"
            className="app-main min-w-0 flex-1 overflow-y-auto p-5 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6 lg:pb-6"
            aria-busy="false"
          >
            {moduleDown && moduleId && (!isAdmin || moduleInfo?.mode === "closed") ? (
              <ModuleMaintenance moduleId={moduleId} />
            ) : (
              <PageTransition>
                {moduleDown && moduleId && isAdmin && (
                  <div
                    className="mb-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium"
                    style={{
                      background: "var(--warning-dim)",
                      borderColor: "var(--warning-border)",
                      color: "var(--warning)",
                    }}
                    role="status">
                    此模組維護中，僅管理員可見；一般使用者目前無法存取。
                  </div>
                )}
                {children}
              </PageTransition>
            )}
          </main>
        </div>
        {!sidebarOpen && <BottomTabBar onMoreClick={() => setSidebarOpen((p) => !p)} />}
        <UrgentAnnouncementPopup />
        <CommandMenu />
        <PolicyConsentBanner
          isAuthenticated={isLoggedIn && !suppressPolicyConsent && !isPublicRoute(pathname)}
        />
      </div>
      </ConfirmProvider>
      </InboxCountsProvider>
    </PermissionProvider>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isBare(pathname)) {
    return <>{children}</>;
  }

  return <SessionGate>{children}</SessionGate>;
}
