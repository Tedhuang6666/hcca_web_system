"use client";

import Link from "next/link";
import {
  MessageSquareText,
  Radio,
  type LucideIcon,
} from "lucide-react";

import { usePublicModuleStatus } from "@/contexts/PublicModuleStatusContext";
import type { ModuleId } from "@/lib/modules";

const SERVICES: Array<{
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  moduleId: ModuleId;
}> = [
  {
    href: "/public/elections",
    title: "即時開票",
    description: "查看公開選舉票數。",
    icon: Radio,
    moduleId: "elections",
  },
  {
    href: "/petitions",
    title: "陳情中心",
    description: "提出陳情或查詢進度。",
    icon: MessageSquareText,
    moduleId: "petitions",
  },
];

export default function PublicHomeServices({
  initialClosedModuleIds,
}: {
  initialClosedModuleIds: ModuleId[];
}) {
  const { statuses } = usePublicModuleStatus();
  const closedModuleIds = Object.keys(statuses).length > 0
    ? new Set(
      Object.values(statuses)
        .filter((status) => status.on && status.mode === "closed")
        .map((status) => status.id),
    )
    : new Set(initialClosedModuleIds);

  const visibleServices = SERVICES.filter((item) => !closedModuleIds.has(item.moduleId));
  if (visibleServices.length === 0) return null;

  return (
    <section aria-labelledby="public-services-title">
      <h2 id="public-services-title" className="mb-4 text-2xl font-semibold">參與服務</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {visibleServices.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-32 items-start gap-4 rounded-xl border border-[var(--public-border)] bg-[var(--public-surface)] p-5 transition-colors hover:bg-[var(--public-soft)]"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--public-soft)] text-[var(--public-accent)]">
                <Icon size={20} aria-hidden />
              </span>
              <span>
                <span className="block font-semibold">{item.title}</span>
                <span className="mt-1.5 block text-sm leading-6 text-[var(--public-secondary)]">
                  {item.description}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
