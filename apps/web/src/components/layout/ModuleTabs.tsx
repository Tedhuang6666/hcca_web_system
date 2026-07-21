"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();

  if (tabs.length <= 1) return null;

  return (
    <nav
      aria-label={label}
      className="module-tabs-scroll module-tabs-primary app-page-width mb-5 overflow-x-auto pt-4"
    >
      <div className="module-tabs-list">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const [tabPath, tabQuery] = tab.href.split("?", 2);
          const tabParams = new URLSearchParams(tabQuery ?? "");
          const queryMatches = [...tabParams.entries()].every(
            ([key, value]) => searchParams.get(key) === value,
          );
          const active = tab.end
            ? pathname === tabPath && searchParams.toString() === ""
            : (pathname === tabPath || pathname.startsWith(`${tabPath}/`)) && queryMatches;
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
