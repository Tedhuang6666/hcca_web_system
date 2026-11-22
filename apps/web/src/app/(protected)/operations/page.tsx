"use client";

import { Mail, Megaphone, ReceiptText, Settings, Store, Wallet } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import ToolLinkList from "@/components/layout/ToolLinkList";

const TOOLS = [
  {
    href: "/publications",
    icon: Megaphone,
    label: "發布中心",
    prefixes: ["announcement:"],
  },
  {
    href: "/email",
    icon: Mail,
    label: "電子郵件",
    prefixes: ["email:"],
  },
  {
    href: "/admin/public-site",
    icon: Settings,
    label: "公開網站設定",
    perms: ["site:manage"],
  },
  {
    href: "/finance/receivables",
    icon: ReceiptText,
    label: "收款對帳",
    prefixes: ["finance:"],
  },
  {
    href: "/finance",
    icon: Wallet,
    label: "財務總帳",
    perms: ["finance:view"],
  },
  {
    href: "/merchandise-submissions/admin",
    icon: Store,
    label: "校商投稿管理",
    perms: [
      "merchandise_submission:view",
      "merchandise_submission:manage",
      "merchandise_submission:review",
      "shop:manage",
    ],
  },
];

export default function OperationsPage() {
  const { can, isAdmin, permissions } = usePermissions();
  const hasPrefix = (prefix: string) => Array.from(permissions).some((perm) => perm.startsWith(prefix));
  const visibleTools = TOOLS.filter((tool) => (
    isAdmin
    || permissions.has("admin:all")
    || tool.perms?.some(can)
    || tool.prefixes?.some(hasPrefix)
  ));

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-5 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">營運中心</h1>
      </header>

      {visibleTools.length === 0 ? (
        <section className="rounded-md border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          目前沒有可使用的營運工具。
        </section>
      ) : (
        <ToolLinkList tools={visibleTools} />
      )}
    </main>
  );
}
