"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "人員主檔", href: "/admin/people" },
  { label: "組織與職位", href: "/admin/permissions" },
] as const;

export default function AdminWorkbenchTabs() {
  const pathname = usePathname();
  return (
    <div
      className="flex flex-shrink-0 items-center gap-1 border-b px-4"
      style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
    >
      {TABS.map(({ label, href }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className="relative px-4 py-3 text-sm font-medium transition-colors"
            style={{
              color: active ? "var(--primary)" : "var(--text-muted)",
              textDecoration: "none",
            }}
          >
            {label}
            {active && (
              <span
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-full"
                style={{ background: "var(--primary)" }}
              />
            )}
          </Link>
        );
      })}
    </div>
  );
}
