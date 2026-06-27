"use client";

import ModuleBoundary from "@/components/ModuleBoundary";
import ModuleTabs, { type ModuleTab } from "@/components/layout/ModuleTabs";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { GraduationCap, Settings } from "lucide-react";

export default function ExamPapersLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, permissions } = usePermissions();
  const canManage = isAdmin || permissions.has("admin:all") || Array.from(permissions).some((p) => p.startsWith("exam:"));
  const tabs: ModuleTab[] = [
    { href: "/exam-papers", label: "題庫", icon: GraduationCap, end: true },
    ...(canManage ? [{ href: "/exam-papers/admin", label: "管理", icon: Settings }] : []),
  ];

  return (
    <ModuleBoundary id="examPapers" skeleton={<ListPageSkeleton />}>
      <ModuleTabs label="題庫分頁" tabs={tabs} />
      {children}
    </ModuleBoundary>
  );
}
