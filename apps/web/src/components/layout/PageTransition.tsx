"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const transitionClass = pathname.startsWith("/legal")
    ? "page-transition-static"
    : "app-page-transition page-sheet-transition";

  return (
    <div key={pathname} className={transitionClass} data-route={pathname}>
      {children}
    </div>
  );
}
