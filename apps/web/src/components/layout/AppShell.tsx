"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

function AppShellContent({ children }: { children: React.ReactNode }) {
  const { can, isAdmin } = usePermissions();
  const { isModuleDown, moduleInfo: getModuleInfo } = useModuleStatus();
  const router = useRouter();
  const pathname = usePathname();
  const moduleId = moduleForPath(pathname);
  const moduleDown = isModuleDown(moduleId);
  const moduleInfo = getModuleInfo(moduleId);
  const suppressPolicyConsent = pathname.startsWith("/legal");
  const [authReady, setAuthReady] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const inboxCounts = useInboxCounts(isLoggedIn);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  // 記住已對哪個 pathname 觸發過導向，避免同一路徑重複呼叫 router.replace
  // 造成 effect ↔ 導航無限互相觸發。
  const redirectedFrom = useRef<string | null>(null);

  // useLayoutEffect 在 DOM 更新後、瀏覽器繪圖前同步執行，
  // 讓 authReady 在首次繪圖前完成，消除空白幕閃爍。
  useLayoutEffect(() => {
    const loggedIn = Boolean(localStorage.getItem("user_id"));
    setIsLoggedIn(loggedIn);

    if (!requiresAuthentication(pathname) || loggedIn) {
      redirectedFrom.current = null;
      setRedirecting(false);
      setAuthReady(true);
      return;
    }

    // 需要登入但未登入：導向 /login（同一路徑只導一次）
    setRedirecting(true);
    setAuthReady(true);
    if (redirectedFrom.current !== pathname) {
      redirectedFrom.current = pathname;
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [pathname, router]);

  // 路由變更時自動關閉行動版側邊欄
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const toggleSidebar = () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setDesktopSidebarOpen((open) => !open);
      return;
    }
    setSidebarOpen((open) => !open);
  };

  // 公開頁（login、官網、維護頁等）不需要等 authReady，立即渲染
  if (isBare(pathname)) {
    return <>{children}</>;
  }

  if (!authReady || redirecting) {
    return (
      <div
        className="grid min-h-screen place-items-center px-6"
        style={{ background: "var(--bg-base)" }}
      >
        <LoadingState
          title={redirecting ? "正在前往登入頁" : "正在確認登入狀態"}
          description="系統正在確認身分與頁面權限。"
        />
      </div>
    );
  }

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
        {/* 行動版側邊欄遮罩 */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: "var(--bg-overlay)" }}
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* 側邊欄 */}
        <div
          className={`
            fixed inset-y-0 left-0 z-50 transition-transform duration-300
            md:relative md:z-auto
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
            ${desktopSidebarOpen ? "md:block md:translate-x-0" : "md:hidden"}
          `}
          style={{ width: "var(--sidebar-w, 240px)" }}>
          <Sidebar />
        </div>

        {/* 主內容區 */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <Topbar onMenuClick={toggleSidebar} />
          <main
            id="main-content"
            className="app-main flex-1 overflow-y-auto p-5 pb-20 md:p-6 md:pb-6"
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
  return (
    <ModuleStatusProvider>
      <AppShellContent>{children}</AppShellContent>
    </ModuleStatusProvider>
  );
}
