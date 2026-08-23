"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import PageTransition from "./PageTransition";

const STANDALONE_PAGE_PREFIXES = [
  "/auth",
  "/blocked",
  "/credential",
  "/login",
  "/maintenance",
  "/module-status",
  "/raffle",
  "/unsubscribe",
];

function needsStandaloneTransition(pathname: string): boolean {
  return pathname === "/"
    || STANDALONE_PAGE_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

export default function BarePageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (!needsStandaloneTransition(pathname)) return <>{children}</>;

  return <PageTransition>{children}</PageTransition>;
}
