"use client";

import Link from "next/link";
import { BarChart3, CalendarDays, Mail, Megaphone, ReceiptText, Settings } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

const TOOLS = [
  {
    href: "/publications",
    icon: Megaphone,
    label: "發布中心",
    desc: "公告、公開網站與多渠道發布任務",
    prefixes: ["announcement:"],
  },
  {
    href: "/email",
    icon: Mail,
    label: "電子郵件",
    desc: "寄送、名單、模板、紀錄與成效",
    prefixes: ["email:"],
  },
  {
    href: "/admin/activities",
    icon: CalendarDays,
    label: "活動管理",
    desc: "活動資料、時程與公開頁內容",
    perms: ["activity:manage"],
  },
  {
    href: "/admin/public-site",
    icon: Settings,
    label: "公開網站設定",
    desc: "首頁、導覽與公開資訊設定",
    perms: ["site:manage"],
  },
  {
    href: "/analytics",
    icon: BarChart3,
    label: "績效統計",
    desc: "平台使用狀況與治理指標",
    perms: ["analytics:view"],
  },
  {
    href: "/finance/receivables",
    icon: ReceiptText,
    label: "收款對帳",
    desc: "應收款、付款狀態與對帳資料",
    prefixes: ["finance:"],
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
        <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
          OPERATIONS
        </p>
        <h1 className="mt-1 text-2xl font-semibold">營運中心</h1>
      </header>

      {visibleTools.length === 0 ? (
        <section className="rounded-md border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          目前沒有可使用的營運工具。
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.href}
                href={tool.href}
                className="rounded-md border p-4 transition-colors hover:bg-[var(--bg-hover)]"
                style={{ borderColor: "var(--border)", textDecoration: "none" }}
              >
                <Icon size={18} aria-hidden={true} style={{ color: "var(--primary)" }} />
                <h2 className="mt-3 text-sm font-semibold">{tool.label}</h2>
                <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-muted)" }}>
                  {tool.desc}
                </p>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
