"use client";

import {
  Barcode,
  BarChart3,
  FileText,
  GraduationCap,
  type LucideIcon,
  MessageSquare,
  Store,
  Ticket,
  Users,
  Vote,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import ToolLinkList from "@/components/layout/ToolLinkList";

type BackofficeWorkspace = "representative" | "council";

type BackofficeTool = {
  href: string;
  icon: LucideIcon;
  label: string;
  perms?: string[];
  prefixes?: string[];
  workspace?: BackofficeWorkspace;
};

const TOOLS: BackofficeTool[] = [
  {
    href: "/admin/people",
    icon: Users,
    label: "人員與組織",
    perms: ["admin:users", "class:manage", "org:manage_members"],
  },
  {
    href: "/document-templates",
    icon: FileText,
    label: "公文範本",
    perms: ["document:draft", "document:create"],
  },
  {
    href: "/serial-templates",
    icon: Barcode,
    label: "字號模板",
    perms: ["serial:create"],
  },
  {
    href: "/exam-papers/admin",
    icon: GraduationCap,
    label: "題庫管理",
    prefixes: ["exam:"],
  },
  {
    href: "/shop/admin",
    icon: Store,
    label: "商品管理",
    perms: ["shop:manage"],
    workspace: "council",
  },
  {
    href: "/shop/council-orders",
    icon: BarChart3,
    label: "全校收款與訂單",
    perms: ["shop:view_all", "shop:manage_orders", "shop:manage"],
    workspace: "council",
  },
  {
    href: "/shop/class-orders",
    icon: Ticket,
    label: "班級收款與代訂",
    perms: ["class:shop_collect"],
    workspace: "representative",
  },
  {
    href: "/shop/admin?view=stats",
    icon: BarChart3,
    label: "訂購統計",
    perms: ["shop:manage"],
    workspace: "council",
  },
  {
    href: "/admin/people?section=classes",
    icon: Users,
    label: "班級與議員設定",
    perms: ["class:manage"],
    workspace: "council",
  },
  {
    href: "/partner-map/admin",
    icon: Store,
    label: "特約管理",
    prefixes: ["partner_map:"],
  },
  {
    href: "/admin/elections",
    icon: Vote,
    label: "開票控制台",
    prefixes: ["election:"],
  },
  {
    href: "/petitions/manage",
    icon: MessageSquare,
    label: "陳情管理",
    prefixes: ["petition:"],
  },
];

export default function BackofficePage() {
  const { can, isAdmin, permissions } = usePermissions();
  const hasPrefix = (prefix: string) => Array.from(permissions).some((perm) => perm.startsWith(prefix));
  const visibleTools = TOOLS.filter((tool) => (
    isAdmin
    || permissions.has("admin:all")
    || tool.perms?.some(can)
    || tool.prefixes?.some(hasPrefix)
  ));
  const workspaces: { id: BackofficeWorkspace; label: string }[] = [
    { id: "representative", label: "班代（議員）工作" },
    { id: "council", label: "班聯統籌" },
  ];
  const otherTools = visibleTools.filter((tool) => !tool.workspace);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-5 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">模組後台</h1>
      </header>

      {visibleTools.length === 0 ? (
        <section className="rounded-md border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          目前沒有可管理的模組。
        </section>
      ) : (
        <div className="space-y-7">
          {workspaces.map((workspace) => {
            const tools = visibleTools.filter((tool) => tool.workspace === workspace.id);
            if (tools.length === 0) return null;
            return (
              <section key={workspace.id} aria-labelledby={`backoffice-${workspace.id}`}>
                <h2 id={`backoffice-${workspace.id}`} className="mb-2 text-base font-semibold">{workspace.label}</h2>
                <ToolLinkList tools={tools} />
              </section>
            );
          })}
          {otherTools.length > 0 && (
            <section aria-labelledby="backoffice-other">
              <h2 id="backoffice-other" className="mb-2 text-base font-semibold">其他模組</h2>
              <ToolLinkList tools={otherTools} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
