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
      className="module-tabs-scroll module-tabs-primary mx-auto mb-5 max-w-6xl overflow-x-auto pt-4"
    >
      <div className="module-tabs-list">
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
              className={`module-tab-link${active ? " is-active" : ""}`}
            >
              <Icon size={15} aria-hidden={true} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
