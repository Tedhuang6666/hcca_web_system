"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { usePublicModuleStatus } from "@/contexts/PublicModuleStatusContext";
import type { ModuleId } from "@/lib/modules";

const SERVICES: Array<{
  href: string;
  title: string;
  description: string;
  moduleId?: ModuleId;
}> = [
  {
    href: "/regulations",
    title: "法規資料庫",
    description: "現行條文與修正沿革",
  },
  {
    href: "/documents",
    title: "公文資料庫",
    description: "公開公文、附件與基本資訊",
  },
  {
    href: "/public/budgets",
    title: "財務總覽",
    description: "各項預算、實際支出與憑證",
  },
  {
    href: "/petitions",
    title: "陳情中心",
    description: "登入後提出陳情，並追蹤案件辦理進度。",
    moduleId: "petitions",
  },
  {
    href: "/public/elections",
    title: "即時開票",
    description: "查看公開選舉票數。",
    moduleId: "elections",
  },
  {
    href: "/petitions/public",
    title: "公開陳情",
    description: "查看已公開案件與處理回覆。",
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

  const visibleServices = SERVICES.filter((item) => !item.moduleId || !closedModuleIds.has(item.moduleId));

  return (
    <nav className="public-directory-list" aria-label="公開資料與校園服務">
      {visibleServices.map((item) => (
        <Link key={item.href} href={item.href} className="public-directory-link">
          <div>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
          </div>
          <ArrowRight size={20} aria-hidden />
        </Link>
      ))}
    </nav>
  );
}
