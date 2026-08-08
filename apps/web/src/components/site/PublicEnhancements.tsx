"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const TelemetryProvider = dynamic(
  () => import("@/components/providers/TelemetryProvider"),
  { ssr: false },
);

export default function PublicEnhancements() {
  return (
    <Suspense fallback={null}>
      <TelemetryProvider />
    </Suspense>
  );
}
