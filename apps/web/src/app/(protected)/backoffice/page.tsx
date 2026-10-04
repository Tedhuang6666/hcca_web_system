"use client";

import Link from "next/link";
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

type BackofficeWorkspace = "representative" | "council";

type BackofficeTool = {
  href: string;
  icon: LucideIcon;
  label: string;
  desc: string;
  perms?: string[];
  prefixes?: string[];
  workspace?: BackofficeWorkspace;
};

const TOOLS: BackofficeTool[] = [
  {
    href: "/admin/people",
    icon: Users,
    label: "人員與組織",
    desc: "人員、帳號、組織職位、權限與班級名冊",
    perms: ["admin:users", "class:manage", "org:manage_members"],
  },
  {
    href: "/document-templates",
    icon: FileText,
    label: "公文範本",
    desc: "維護常用公文格式與內容模板",
    perms: ["document:draft", "document:create"],
  },
  {
    href: "/serial-templates",
    icon: Barcode,
    label: "字號模板",
    desc: "設定公文字號規則與流水號模板",
    perms: ["serial:create"],
  },
  {
    href: "/exam-papers/admin",
    icon: GraduationCap,
    label: "題庫管理",
    desc: "管理段考題庫與上架內容",
    prefixes: ["exam:"],
  },
  {
    href: "/shop/admin",
    icon: Store,
    label: "商品與活動設定",
    desc: "商品目錄、活動與訂購設定",
    perms: ["shop:manage"],
    workspace: "council",
  },
  {
    href: "/shop/council-orders",
    icon: BarChart3,
    label: "全校訂單與收款",
    desc: "統籌各班訂購、收款進度與結單狀態",
    perms: ["shop:view_all", "shop:manage_orders", "shop:manage"],
    workspace: "council",
  },
  {
    href: "/shop/class-orders",
    icon: Ticket,
    label: "議員收款與代訂",
    desc: "替本班同學登記商品並追蹤收款",
    perms: ["class:shop_collect"],
    workspace: "representative",
  },
  {
    href: "/partner-map/admin",
    icon: Store,
    label: "特約管理",
    desc: "維護特約商店與地圖資料",
    prefixes: ["partner_map:"],
  },
  {
    href: "/admin/elections",
    icon: Vote,
    label: "開票控制台",
    desc: "選舉開票與公開看板控制",
    prefixes: ["election:"],
  },
  {
    href: "/petitions/manage",
    icon: MessageSquare,
    label: "陳情管理",
    desc: "陳情分派、處理與類型設定",
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
  const workspaces: { id: BackofficeWorkspace; label: string; description: string }[] = [
    {
      id: "representative",
      label: "議員工作台",
      description: "處理本班同學的商品登記與收款。",
    },
    {
      id: "council",
      label: "班聯統籌",
      description: "管理全校商品與各班訂購進度。",
    },
  ];
  const renderTools = (tools: BackofficeTool[]) => tools.map((tool) => {
    const Icon = tool.icon;
    return (
      <Link
        key={tool.href}
        href={tool.href}
        className="rounded-md border p-4 transition-colors hover:bg-[var(--bg-hover)]"
        style={{ borderColor: "var(--border)", textDecoration: "none" }}
      >
        <Icon size={18} aria-hidden={true} style={{ color: "var(--info)" }} />
        <h3 className="mt-3 text-sm font-semibold">{tool.label}</h3>
        <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-muted)" }}>
          {tool.desc}
        </p>
      </Link>
    );
  });
  const otherTools = visibleTools.filter((tool) => !tool.workspace);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-5 md:p-6">
      <header>
        <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
          BACKOFFICE
        </p>
        <h1 className="mt-1 text-2xl font-semibold">模組後台</h1>
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
                <header className="mb-3">
                  <h2 id={`backoffice-${workspace.id}`} className="text-base font-semibold">{workspace.label}</h2>
                  <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{workspace.description}</p>
                </header>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{renderTools(tools)}</div>
              </section>
            );
          })}
          {otherTools.length > 0 && (
            <section aria-labelledby="backoffice-other">
              <h2 id="backoffice-other" className="mb-3 text-base font-semibold">其他模組</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{renderTools(otherTools)}</div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
