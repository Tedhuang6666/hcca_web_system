import { Suspense } from "react";

import TelemetryProvider from "@/components/providers/TelemetryProvider";
import "../public-design-system.css";
import "./public-home.css";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <TelemetryProvider />
      </Suspense>
      {children}
    </>
  );
}
