"use client";

import ModuleTabs, { type ModuleTab } from "@/components/layout/ModuleTabs";
import { usePermissions } from "@/hooks/usePermissions";
import { ClipboardCheck, MapPinned, Settings } from "lucide-react";

export default function PartnerMapTabs() {
  const { isAdmin, permissions } = usePermissions();
  const canManage =
    isAdmin ||
    permissions.has("admin:all") ||
    Array.from(permissions).some((permission) => permission.startsWith("partner_map:"));
  const tabs: ModuleTab[] = [
    { href: "/partner-map", label: "地圖", icon: MapPinned, end: true },
    ...(canManage ? [{ href: "/partner-map/admin", label: "管理", icon: Settings }] : []),
    ...(canManage ? [{ href: "/partner-map/admin/applications", label: "申請審核", icon: ClipboardCheck }] : []),
  ];

  return <ModuleTabs label="特約地圖分頁" tabs={tabs} />;
}
