"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PermissionProvider } from "@/contexts/PermissionContext";
import { usePermissions } from "@/hooks/usePermissions";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import UrgentAnnouncementPopup from "@/components/announcements/UrgentAnnouncementPopup";

/** 完全裸頁（不渲染 Shell）：login、auth callback */
const BARE_PATHS = ["/login", "/auth", "/profile/complete", "/public"];

function isBare(pathname: string) {
  return BARE_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** 是否需要登入 */
function requiresAuth(pathname: string): boolean {
  if (isBare(pathname)) return false;
  if (pathname === "/regulations") return false;
  if (/^\/regulations\/[^/]+$/.test(pathname)) return false;
  if (pathname === "/documents") return false;
  if (pathname === "/documents/delegations") return true;
  if (/^\/documents\/[^/]+$/.test(pathname) && !pathname.endsWith("/edit")) return false;
  if (pathname === "/announcements") return false;
  if (/^\/announcements\/[^/]+$/.test(pathname)) return false;
  if (pathname === "/petitions") return false;
  if (pathname === "/petitions/new") return false;
  return true;
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const { can } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const [authReady, setAuthReady] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!requiresAuth(pathname)) {
      setRedirecting(false);
      setAuthReady(true);
      return;
    }
    const userId = localStorage.getItem("user_id");
    if (!userId) {
      setRedirecting(true);
      // 未登入的初次進站預設導向公開法規，避免被迫進 /login
      if (pathname === "/") {
        router.replace("/regulations");
      } else {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      }
      setAuthReady(true);
      return;
    }
    setRedirecting(false);
    setAuthReady(true);
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
      <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg-base)" }}>
        {/* 行動版側邊欄遮罩 */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 lg:hidden"
            style={{ background: "var(--bg-overlay)" }}
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* 側邊欄 */}
        <div
          className={`
            fixed inset-y-0 left-0 z-30 transition-transform duration-300
            lg:relative lg:translate-x-0 lg:z-auto
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
            className="flex-1 overflow-y-auto p-5 md:p-6 animate-slide-in"
            style={{ background: "var(--bg-base)" }}>
            {children}
          </main>
        </div>
        <UrgentAnnouncementPopup />
      </div>
    </PermissionProvider>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return <AppShellContent>{children}</AppShellContent>;
}
