"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [previousPathname, setPreviousPathname] = useState(pathname);
  const [hasNavigated, setHasNavigated] = useState(false);

  // SSR and hydration must show the content immediately. Animate subsequent
  // navigations, including a return to the route used for the initial load.
  if (pathname !== previousPathname) {
    setPreviousPathname(pathname);
    setHasNavigated(true);
  }

  const transitionClass = !hasNavigated || pathname.startsWith("/legal")
    ? "app-page-transition page-transition-static"
    : "app-page-transition page-sheet-transition";

  return (
    <div key={pathname} className={transitionClass} data-route={pathname}>
      {children}
    </div>
  );
}
