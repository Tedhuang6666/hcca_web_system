import type { Metadata } from "next";
import { Toaster } from "sonner";

import AppShell from "@/components/layout/AppShell";
import AppEnhancements from "@/components/layout/AppEnhancements";
import NavigationProgress from "@/components/layout/NavigationProgress";
import AccessBlockGuard from "@/components/security/AccessBlockGuard";
import ScrollProgressBar from "@/components/ui/ScrollProgressBar";
import { getServerSession } from "@/lib/server/session";
import "../design-system.css";

// 管理頁面同樣使用 per-request CSP nonce，必須避免靜態 HTML 快取造成 nonce 不一致。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const initialUser = await getServerSession();

  return (
    <>
      <AccessBlockGuard />
      <NavigationProgress />
      <ScrollProgressBar />
      <AppShell initialUser={initialUser}>{children}</AppShell>
      <AppEnhancements />
      <Toaster
        position="top-right"
        richColors
        toastOptions={{
          style: {
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-primary)",
            fontSize: "0.875rem",
          },
        }}
      />
    </>
  );
}
