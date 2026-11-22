import type { Metadata } from "next";

import AppShell from "@/components/layout/AppShell";
import AppEnhancements from "@/components/layout/AppEnhancements";
import NavigationProgress from "@/components/layout/NavigationProgress";
import AccessBlockGuard from "@/components/security/AccessBlockGuard";
import PerformanceProvider from "@/components/providers/PerformanceProvider";
import { getServerImportantAnnouncement, getServerSession } from "@/lib/server/session";
import "../design-system.css";

// 受保護頁面使用 per-request CSP nonce；禁止 Next 將含有 inline bootstrap
// script 的 HTML 預先渲染並長期快取，否則回應 header 的 nonce 會與 HTML 不一致。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [initialUser, initialImportantAnnouncement] = await Promise.all([
    getServerSession(),
    getServerImportantAnnouncement(),
  ]);

  return (
    <>
      <AccessBlockGuard />
      <NavigationProgress />
      <PerformanceProvider>
        <AppShell
          initialUser={initialUser}
          initialImportantAnnouncement={initialImportantAnnouncement}
        >
          {children}
        </AppShell>
      </PerformanceProvider>
      <AppEnhancements />
    </>
  );
}
