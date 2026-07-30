"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "人員主檔", href: "/admin/people" },
  { label: "帳號維護", href: "/admin/users" },
  { label: "組織與職位", href: "/admin/permissions" },
  { label: "客服作業平台", href: "/admin/support" },
] as const;

export default function AdminWorkbenchTabs() {
  const pathname = usePathname();
  return (
    <div
      className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b px-3 sm:px-4"
      style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
    >
      {TABS.map(({ label, href }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className="relative min-h-11 shrink-0 px-3 py-3 text-sm font-medium transition-colors sm:px-4"
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
