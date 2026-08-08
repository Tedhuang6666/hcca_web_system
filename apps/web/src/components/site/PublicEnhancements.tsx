"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";

const TelemetryProvider = dynamic(
  () => import("@/components/providers/TelemetryProvider"),
  { ssr: false },
);

export default function PublicEnhancements() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(() => setReady(true), { timeout: 3_000 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(() => setReady(true), 2_000);
    return () => window.clearTimeout(timeoutId);
  }, []);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <TelemetryProvider />
    </Suspense>
  );
}
