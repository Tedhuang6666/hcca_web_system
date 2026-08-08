import { Toaster } from "sonner";

import AppShell from "@/components/layout/AppShell";
import AppEnhancements from "@/components/layout/AppEnhancements";
import NavigationProgress from "@/components/layout/NavigationProgress";
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
