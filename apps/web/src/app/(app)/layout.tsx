import { Suspense } from "react";
import { Toaster } from "sonner";

import GoogleOneTap from "@/components/auth/GoogleOneTap";
import AppShell from "@/components/layout/AppShell";
import NavigationProgress from "@/components/layout/NavigationProgress";
import TelemetryProvider from "@/components/providers/TelemetryProvider";
import PwaInstallPrompt from "@/components/pwa/PwaInstallPrompt";
import AccessBlockGuard from "@/components/security/AccessBlockGuard";
import ScrollProgressBar from "@/components/ui/ScrollProgressBar";
import "../design-system.css";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AccessBlockGuard />
      <NavigationProgress />
      <ScrollProgressBar />
      <AppShell>{children}</AppShell>
      <Suspense fallback={null}>
        <TelemetryProvider />
      </Suspense>
      <PwaInstallPrompt />
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
      <Suspense fallback={null}>
        <GoogleOneTap />
      </Suspense>
    </>
  );
}
