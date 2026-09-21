import "./survey-motion.css";
import { Toaster } from "sonner";

import PublicRouteShell from "@/components/site/PublicRouteShell";

export default function PublicSurveysLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicRouteShell>{children}</PublicRouteShell>
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
