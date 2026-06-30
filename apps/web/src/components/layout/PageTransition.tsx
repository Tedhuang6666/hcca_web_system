"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reducedMotionSafe = pathname.startsWith("/legal") ? "" : "app-page-transition";

  return (
    <div className={reducedMotionSafe}>
      {children}
    </div>
  );
}
