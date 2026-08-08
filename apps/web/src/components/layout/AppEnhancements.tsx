"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

// These features are useful after the page is interactive, but none is part
// of the first task. Keep them out of the critical App Router client chunk.
const GoogleOneTap = dynamic(() => import("@/components/auth/GoogleOneTap"), { ssr: false });
const TelemetryProvider = dynamic(() => import("@/components/providers/TelemetryProvider"), { ssr: false });
const PwaInstallPrompt = dynamic(() => import("@/components/pwa/PwaInstallPrompt"), { ssr: false });

export default function AppEnhancements() {
  return (
    <>
      <Suspense fallback={null}>
        <TelemetryProvider />
      </Suspense>
      <PwaInstallPrompt />
      <Suspense fallback={null}>
        <GoogleOneTap />
      </Suspense>
    </>
  );
}
