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
import ImportantAnnouncementBanner from "@/components/site/ImportantAnnouncementBanner";
const CommandMenu = dynamic(() => import("./CommandMenu"), { ssr: false });
const UrgentAnnouncementPopup = dynamic(() => import("@/components/announcements/UrgentAnnouncementPopup"), { ssr: false });
const PasskeySetupPrompt = dynamic(() => import("@/components/auth/PasskeySetupPrompt"), { ssr: false });
const ImpersonationBanner = dynamic(
  () => import("@/components/admin/ImpersonationBanner").then((module) => module.ImpersonationBanner),
  { ssr: false },
);
import { PolicyConsentBanner } from "@/components/legal/PolicyConsentBanner";
import { isBareRoute, isPublicRoute, requiresAuthentication } from "@/lib/route-access";
import { ApiError } from "@/lib/api-helpers";
import { authApi } from "@/lib/api/auth";
import { cacheCurrentUser, clearAuthCache } from "@/lib/auth-cache";
import type { ServerSessionUser } from "@/lib/server/session";

const AUTH_CHECK_TIMEOUT_MS = 8_000;

async function withAuthCheckTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new ApiError(0, "登入服務回應逾時"));
    }, AUTH_CHECK_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

function SessionGate({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  initialUser: ServerSessionUser | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authReady, setAuthReady] = useState(Boolean(initialUser));
  const [redirecting, setRedirecting] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(Boolean(initialUser));
  const authCheckStarted = useRef(false);
  const redirectedFrom = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!requiresAuthentication(pathname)) {
      setIsLoggedIn(Boolean(localStorage.getItem("user_id")));
      setRedirecting(false);
      setAuthReady(true);
      return () => {
        cancelled = true;
      };
    }

    // 首次進入受保護頁面才需要遮住 Shell 等待驗證；站內換頁時保留既有
    // Shell，避免底部導覽列跟著整個 AppShellContent 被卸載又重新掛載。
    const isInitialAuthCheck = !authCheckStarted.current;
    authCheckStarted.current = true;
    if (initialUser) cacheCurrentUser(initialUser);
    if (isInitialAuthCheck && !initialUser) setAuthReady(false);
    const verifySession = async () => {
      const loggedIn = Boolean(localStorage.getItem("user_id"));
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
        const me = await withAuthCheckTimeout(authApi.me());
        if (cancelled) return;
        cacheCurrentUser(me);
        setIsLoggedIn(true);
        redirectedFrom.current = null;
        setRedirecting(false);
        setAuthReady(true);
      } catch (error) {
        if (cancelled) return;
        // 暫時性網路/API 失敗不能清除登入快取，否則短暫 503 會被誤判成
        // 登入失效，導致管理權限畫面消失，使用者只能重新登入。
        if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
          setIsLoggedIn(true);
          setRedirecting(false);
          setAuthReady(true);
          return;
        }
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

    // 伺服器已在受保護 layout 驗證並傳入 session；首屏 hydration 不再重複
    // 呼叫 /auth/me。仍在視窗重新取得焦點時驗證，確保長時間停留後可收斂狀態。
    if (initialUser) {
      setIsLoggedIn(true);
      setRedirecting(false);
      setAuthReady(true);
      const revalidate = () => {
        if (document.visibilityState === "visible") void verifySession();
      };
      window.addEventListener("focus", revalidate);
      document.addEventListener("visibilitychange", revalidate);
      return () => {
        cancelled = true;
        window.removeEventListener("focus", revalidate);
        document.removeEventListener("visibilitychange", revalidate);
      };
    }

    void verifySession();
    const revalidate = () => {
      if (document.visibilityState === "visible") void verifySession();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [initialUser, pathname, router]);

  // 公開詳情頁不需要等待瀏覽器端驗證；讓伺服器預先輸出的正文直接進入首屏。
  // 受保護路徑仍沿用原本的驗證閘門與登入導向。
  if (isPublicRoute(pathname)) {
    return (
      <ModuleStatusProvider authenticated={false}>
        <AppShellContent isLoggedIn={false}>{children}</AppShellContent>
      </ModuleStatusProvider>
    );
  }

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
  const { can, isAdmin, permissions } = usePermissions();
  const { isModuleDown, moduleInfo: getModuleInfo } = useModuleStatus();
  const pathname = usePathname();
  const moduleId = moduleForPath(pathname);
  const moduleDown = isModuleDown(moduleId);
  const moduleInfo = getModuleInfo(moduleId);
  const hasTaskAccess = isAdmin
    || permissions.has("admin:all")
    || Array.from(permissions).some(
      (permission) => permission.startsWith("document:") || permission.startsWith("regulation:"),
    );
  const suppressPolicyConsent = pathname.startsWith("/legal");
  const inboxCounts = useInboxCounts(isLoggedIn && hasTaskAccess);
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
      <div className="app-shell flex h-[100dvh] overflow-hidden">
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
            className="fixed inset-0 z-[105] lg:hidden"
            style={{ background: "var(--bg-overlay)" }}
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* 側邊欄 */}
        <div
          className={`
            fixed inset-y-0 left-0 z-[110] transition-transform duration-300
            lg:relative lg:z-auto
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
            ${desktopSidebarOpen ? "lg:block lg:translate-x-0" : "lg:hidden"}
          `}
          style={{ width: "var(--sidebar-w, 240px)" }}>
          <Sidebar />
        </div>

        {/* 主內容區 */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <ImpersonationBanner />
          <ImportantAnnouncementBanner />
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
        {isLoggedIn && <UrgentAnnouncementPopup />}
        <CommandMenu />
        <PolicyConsentBanner
          isAuthenticated={isLoggedIn && !suppressPolicyConsent && !isPublicRoute(pathname)}
        />
      </div>
      {isLoggedIn && <PasskeySetupPrompt />}
      </ConfirmProvider>
      </InboxCountsProvider>
    </PermissionProvider>
  );
}

export default function AppShell({
  children,
  initialUser = null,
}: {
  children: React.ReactNode;
  initialUser?: ServerSessionUser | null;
}) {
  const pathname = usePathname();

  if (isBareRoute(pathname)) {
    return <>{children}</>;
  }

  return <SessionGate initialUser={initialUser}>{children}</SessionGate>;
}
