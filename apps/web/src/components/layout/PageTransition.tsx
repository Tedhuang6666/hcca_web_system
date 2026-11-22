"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

function sectionOf(pathname: string): string {
  return pathname.split("/")[1] ?? "";
}

export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [route, setRoute] = useState<{ current: string; previous: string | null }>({
    current: pathname,
    previous: null,
  });

  // SSR and hydration must show the content immediately. Animate subsequent
  // navigations, including a return to the route used for the initial load.
  if (pathname !== route.current) {
    setRoute({ current: pathname, previous: route.current });
  }

  const hasNavigated = route.previous !== null;
  const transitionClass = !hasNavigated || pathname.startsWith("/legal")
    ? "app-page-transition page-transition-static"
    : "app-page-transition page-sheet-transition";
  // 同一模組內換頁時，模組分頁等導覽保持不動，只讓下方內容進場（樣式見 09-continuity-motion.css）。
  const sameSection = route.previous !== null && sectionOf(route.previous) === sectionOf(pathname);

  return (
    <div
      key={pathname}
      className={transitionClass}
      data-route={pathname}
      data-continuity={sameSection ? "section" : undefined}
    >
      {children}
    </div>
  );
}
