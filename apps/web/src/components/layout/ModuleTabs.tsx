"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

export type ModuleTab = {
  href: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

export default function ModuleTabs({
  label,
  tabs,
}: {
  label: string;
  tabs: ModuleTab[];
}) {
  const pathname = usePathname();

  if (tabs.length <= 1) return null;

  return (
    <nav
      aria-label={label}
      className="mx-auto mb-4 flex max-w-6xl gap-1 overflow-x-auto px-5 pt-5 md:px-6"
      style={{ scrollbarWidth: "none" }}
    >
      <div
        className="flex gap-1 rounded-lg p-1"
        style={{ background: "var(--bg-muted)" }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.end
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className="inline-flex min-h-10 flex-shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors"
              style={{
                background: active ? "var(--bg-elevated)" : "transparent",
                color: active ? "var(--text-primary)" : "var(--text-muted)",
                boxShadow: active ? "var(--shadow-sm)" : "none",
                textDecoration: "none",
              }}
            >
              <Icon size={15} aria-hidden={true} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
