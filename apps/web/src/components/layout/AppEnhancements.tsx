"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

// These features are useful after the page is interactive, but none is part
// of the first task. Keep them out of the critical App Router client chunk.
const GoogleOneTap = dynamic(() => import("@/components/auth/GoogleOneTap"), { ssr: false });
const TelemetryProvider = dynamic(() => import("@/components/providers/TelemetryProvider"), { ssr: false });
const PwaInstallPrompt = dynamic(() => import("@/components/pwa/PwaInstallPrompt"), { ssr: false });

export default function AppEnhancements() {
  const pathname = usePathname();
  const isPetitionsRoute = pathname === "/petitions" || pathname.startsWith("/petitions/");

  return (
    <>
      <Suspense fallback={null}>
        <TelemetryProvider />
      </Suspense>
      {!isPetitionsRoute && <PwaInstallPrompt />}
      <Suspense fallback={null}>
        {!isPetitionsRoute && <GoogleOneTap />}
      </Suspense>
    </>
  );
}
