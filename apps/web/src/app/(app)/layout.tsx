import { Suspense } from "react";

import GoogleOneTap from "@/components/auth/GoogleOneTap";
import AppShell from "@/components/layout/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppShell>{children}</AppShell>
      <Suspense fallback={null}>
        <GoogleOneTap />
      </Suspense>
    </>
  );
}
