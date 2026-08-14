"use client";

import Link from "next/link";
import {
  Megaphone,
  MessageSquareText,
  Radio,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

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
    description: "查看公開選舉的即時票數、開票率與票匭進度。",
    icon: Radio,
    moduleId: "elections",
  },
  {
    href: "/news",
    title: "最新公告",
    description: "掌握班聯會最新消息與公開說明。",
    icon: Megaphone,
    moduleId: "announcements",
  },
  {
    href: "/petitions",
    title: "陳情中心",
    description: "提出陳情、用案號查詢案件進度。",
    icon: MessageSquareText,
    moduleId: "petitions",
  },
];

const MODULE_STATUS_REFRESH_MS = 30_000;

export default function PublicHomeServices({
  initialClosedModuleIds,
}: {
  initialClosedModuleIds: ModuleId[];
}) {
  const [closedModuleIds, setClosedModuleIds] = useState<Set<string>>(
    () => new Set(initialClosedModuleIds),
  );

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const response = await fetch("/api/system/module-status", { cache: "no-store" });
        if (!response.ok) return;

        const statuses = (await response.json()) as Array<{
          id: string;
          on: boolean;
          mode: string;
        }>;
        if (active) {
          setClosedModuleIds(
            new Set(
              statuses
                .filter((status) => status.on && status.mode === "closed")
                .map((status) => status.id),
            ),
          );
        }
      } catch {
        // 維持伺服器端送來的上一份狀態，避免網路暫時中斷時入口消失。
      }
    };

    void refresh();
    const intervalId = window.setInterval(refresh, MODULE_STATUS_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const visibleServices = SERVICES.filter((item) => !closedModuleIds.has(item.moduleId));

  return (
    <section>
      <div className="mb-4">
        <p className="public-section-kicker">Participation</p>
        <h2 className="mt-2 text-2xl font-semibold">公開參與服務</h2>
      </div>
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
