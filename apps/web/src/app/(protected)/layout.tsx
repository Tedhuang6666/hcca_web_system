import type { Metadata } from "next";
import { Toaster } from "sonner";

import AppShell from "@/components/layout/AppShell";
import AppEnhancements from "@/components/layout/AppEnhancements";
import NavigationProgress from "@/components/layout/NavigationProgress";
import AccessBlockGuard from "@/components/security/AccessBlockGuard";
import ScrollProgressBar from "@/components/ui/ScrollProgressBar";
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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AccessBlockGuard />
      <NavigationProgress />
      <ScrollProgressBar />
      <AppShell>{children}</AppShell>
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
