"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { toast } from "sonner";
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
import { LoadingState } from "@/components/ui/LoadingState";
import ModuleMaintenance from "@/components/ui/ModuleMaintenance";
import ImportantAnnouncementBanner from "@/components/site/ImportantAnnouncementBanner";
const CommandMenu = dynamic(() => import("./CommandMenu"), { ssr: false });
const UrgentAnnouncementPopup = dynamic(() => import("@/components/announcements/UrgentAnnouncementPopup"), { ssr: false });
const PasskeySetupPrompt = dynamic(() => import("@/components/auth/PasskeySetupPrompt"), { ssr: false });
import { PolicyConsentBanner } from "@/components/legal/PolicyConsentBanner";
import { isBareRoute, isPublicRoute, requiresAuthentication } from "@/lib/route-access";
import { ApiError } from "@/lib/api-helpers";
import { authApi } from "@/lib/api/auth";
import { cacheCurrentUser, clearAuthCache } from "@/lib/auth-cache";
import { PERMISSION_DENIED_EVENT, type PermissionDeniedDetail } from "@/lib/permission-events";
import type { ServerImportantAnnouncement, ServerSessionUser } from "@/lib/server/session";

const AUTH_CHECK_TIMEOUT_MS = 8_000;
const AUTH_RETRY_DELAY_MS = 5_000;
type PermissionSnapshot = Pick<ServerSessionUser, "is_superuser" | "is_owner" | "permissions">;

function hasCachedPermissionSnapshot(): boolean {
  return ["permissions", "is_superuser", "is_owner"].every(
    (key) => sessionStorage.getItem(key) !== null,
  );
}

function cachedPermissionCodes(): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem("permissions") ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function permissionSignature(user: PermissionSnapshot): string {
  return JSON.stringify({
    is_superuser: user.is_superuser ?? false,
    is_owner: user.is_owner ?? false,
    permissions: [...user.permissions].sort(),
  });
}

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
  initialImportantAnnouncement,
}: {
  children: React.ReactNode;
  initialUser: ServerSessionUser | null;
  initialImportantAnnouncement: ServerImportantAnnouncement | null | undefined;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authReady, setAuthReady] = useState(Boolean(initialUser));
  const [redirecting, setRedirecting] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(Boolean(initialUser));
  const authCheckStarted = useRef(false);
  const authVerified = useRef(Boolean(initialUser));
  const redirectedFrom = useRef<string | null>(null);
  const cachedInitialUser = useRef<ServerSessionUser | null>(null);
  const permissionRefreshInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

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
    if (initialUser && cachedInitialUser.current !== initialUser) {
      cacheCurrentUser(initialUser);
      cachedInitialUser.current = initialUser;
    }
    if (isInitialAuthCheck && !initialUser) {
      const hasLocalLogin = Boolean(localStorage.getItem("user_id"));
      // localStorage 只用來辨認上次登入者；沒有權限快照時不能把空集合當成拒絕。
      setIsLoggedIn(hasLocalLogin);
      setAuthReady(hasLocalLogin && hasCachedPermissionSnapshot());
    }
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
        authVerified.current = true;
        setIsLoggedIn(true);
        redirectedFrom.current = null;
        setRedirecting(false);
        setAuthReady(true);
      } catch (error) {
        if (cancelled) return;
        // 暫時性網路/API 失敗不能清除登入快取，否則短暫 503 會被誤判成
        // 登入失效，導致管理權限畫面消失，使用者只能重新登入。
        if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
          authVerified.current = true;
          setIsLoggedIn(true);
          setRedirecting(false);
          const hasCachedPermissions = hasCachedPermissionSnapshot();
          setAuthReady(hasCachedPermissions);
          if (!hasCachedPermissions) {
            retryTimer = window.setTimeout(() => {
              if (!cancelled) void verifySession();
            }, AUTH_RETRY_DELAY_MS);
          }
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
      authVerified.current = true;
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

    // server session 暫時失敗時，首次瀏覽器驗證成功後不要在每次 pathname
    // 變更時再次阻塞頁面；focus/visibility 事件仍會在背景重新驗證。
    if (!isInitialAuthCheck && authVerified.current && hasCachedPermissionSnapshot()) {
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
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [initialUser, pathname, router]);

  useEffect(() => {
    const refreshPermissionsAfterDenied = async (event: Event) => {
      if (permissionRefreshInFlight.current) return;
      permissionRefreshInFlight.current = true;
      const detail = (event as CustomEvent<PermissionDeniedDetail>).detail;
      const before = {
        is_superuser: sessionStorage.getItem("is_superuser") === "true",
        is_owner: sessionStorage.getItem("is_owner") === "true",
        permissions: cachedPermissionCodes(),
      } satisfies PermissionSnapshot;

      try {
        const current = await withAuthCheckTimeout(authApi.refresh());
        cacheCurrentUser(current);
        if (permissionSignature(before) !== permissionSignature(current)) {
          toast.warning("你的權限已更新，畫面已同步最新可用功能。");
          router.refresh();
        } else {
          toast.error(detail?.message || "你目前沒有使用這項功能的權限。");
        }
      } catch {
        toast.error("無法同步最新權限，請稍後重試。");
      } finally {
        permissionRefreshInFlight.current = false;
      }
    };

    window.addEventListener(PERMISSION_DENIED_EVENT, refreshPermissionsAfterDenied);
    return () => window.removeEventListener(PERMISSION_DENIED_EVENT, refreshPermissionsAfterDenied);
  }, [router]);

  // 公開詳情頁不需要等待瀏覽器端驗證；讓伺服器預先輸出的正文直接進入首屏。
  // 受保護路徑仍沿用原本的驗證閘門與登入導向。
  if (isPublicRoute(pathname)) {
    // 公開 layout 已有 PublicModuleStatusProvider；AppShell 的 authenticated
    // module endpoint 只服務登入後功能，避免訪客首屏多打一個背景請求。
    return (
      <AppShellContent
        isLoggedIn={false}
        initialImportantAnnouncement={initialImportantAnnouncement}
      >
        {children}
      </AppShellContent>
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
    <ModuleStatusProvider authenticated={isLoggedIn} pollEnabled={isLoggedIn}>
      <AppShellContent
        isLoggedIn={isLoggedIn}
        initialImportantAnnouncement={initialImportantAnnouncement}
      >
        {children}
      </AppShellContent>
    </ModuleStatusProvider>
  );
}

function AppShellContent({
  children,
  isLoggedIn,
  initialImportantAnnouncement,
}: {
  children: React.ReactNode;
  isLoggedIn: boolean;
  initialImportantAnnouncement: ServerImportantAnnouncement | null | undefined;
}) {
  const { can, isAdmin, isReady, permissions } = usePermissions();
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

  if (isLoggedIn && !isReady) {
    return (
      <div className="app-content-loading" aria-live="polite">
        <LoadingState
          title="正在同步權限"
          description="系統正在確認你可使用的功能，請稍候。"
        />
      </div>
    );
  }

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
          <ImportantAnnouncementBanner announcement={initialImportantAnnouncement} />
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
      </InboxCountsProvider>
    </PermissionProvider>
  );
}

export default function AppShell({
  children,
  initialUser = null,
  initialImportantAnnouncement,
}: {
  children: React.ReactNode;
  initialUser?: ServerSessionUser | null;
  initialImportantAnnouncement?: ServerImportantAnnouncement | null;
}) {
  const pathname = usePathname();

  if (isBareRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <SessionGate
      initialUser={initialUser}
      initialImportantAnnouncement={initialImportantAnnouncement}
    >
      {children}
    </SessionGate>
  );
}
