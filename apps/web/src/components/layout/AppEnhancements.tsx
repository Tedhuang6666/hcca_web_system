"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Suspense } from "react";

// These features are useful after the page is interactive, but none is part
// of the first task. Keep them out of the critical App Router client chunk.
const GoogleOneTap = dynamic(() => import("@/components/auth/GoogleOneTap"), { ssr: false });
const TelemetryProvider = dynamic(() => import("@/components/providers/TelemetryProvider"), { ssr: false });

export default function AppEnhancements() {
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const isPetitionsRoute = pathname === "/petitions" || pathname.startsWith("/petitions/");

  useEffect(() => {
    if (isPetitionsRoute) return;
    const suppressInstallPrompt = (event: Event) => event.preventDefault();
    window.addEventListener("beforeinstallprompt", suppressInstallPrompt);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Push notifications can register the worker when a user enables them.
      });
    }
    return () => window.removeEventListener("beforeinstallprompt", suppressInstallPrompt);
  }, [isPetitionsRoute]);

  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(() => setReady(true), { timeout: 2_000 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timeoutId = window.setTimeout(() => setReady(true), 1_500);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <>
      {!ready ? null : (
        <>
          <Suspense fallback={null}>
            <TelemetryProvider />
          </Suspense>
          <Suspense fallback={null}>
            {!isPetitionsRoute && <GoogleOneTap />}
          </Suspense>
        </>
      )}
    </>
  );
}
