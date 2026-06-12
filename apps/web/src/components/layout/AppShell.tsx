"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PermissionProvider } from "@/contexts/PermissionContext";
import { ModuleStatusProvider, useModuleStatus } from "@/contexts/ModuleStatusContext";
import { usePermissions } from "@/hooks/usePermissions";
import { moduleForPath } from "@/lib/modules";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import BottomTabBar from "./BottomTabBar";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import ModuleMaintenance from "@/components/ui/ModuleMaintenance";
import UrgentAnnouncementPopup from "@/components/announcements/UrgentAnnouncementPopup";
import CommandMenu from "./CommandMenu";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 記住已對哪個 pathname 觸發過導向，避免同一路徑重複呼叫 router.replace
  // 造成 effect ↔ 導航無限互相觸發。
  const redirectedFrom = useRef<string | null>(null);

  useEffect(() => {
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

  if (!authReady || redirecting) {
    return <div className="min-h-screen" style={{ background: "var(--bg-base)" }} />;
  }

  if (isBare(pathname)) {
    return <>{children}</>;
  }

  return (
    <PermissionProvider can={can}>
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
            md:relative md:translate-x-0 md:z-auto
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          `}
          style={{ width: "var(--sidebar-w, 240px)" }}>
          <Sidebar />
        </div>

        {/* 主內容區 */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <Topbar onMenuClick={() => setSidebarOpen((p) => !p)} />
          <main
            id="main-content"
            className={`app-main flex-1 overflow-y-auto p-5 pb-20 md:p-6 md:pb-6 ${
              pathname.startsWith("/legal") ? "" : "animate-slide-in"
            }`}
          >
            {moduleDown && moduleId && (!isAdmin || moduleInfo?.mode === "closed") ? (
              <ModuleMaintenance moduleId={moduleId} />
            ) : (
              <>
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
              </>
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
