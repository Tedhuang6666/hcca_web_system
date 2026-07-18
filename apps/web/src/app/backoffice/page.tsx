"use client";

import Link from "next/link";
import {
  Barcode,
  FileText,
  GraduationCap,
  MessageSquare,
  Network,
  Store,
  Ticket,
  Truck,
  Users,
  Vote,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

const TOOLS = [
  {
    href: "/admin/classes",
    icon: Users,
    label: "班級管理",
    desc: "班級名冊、幹部與學年度設定",
    perms: ["class:manage"],
  },
  {
    href: "/orgs",
    icon: Network,
    label: "組織管理",
    desc: "組織樹、職位與任期資料",
    prefixes: ["org:"],
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
    label: "商品後台",
    desc: "商品、庫存、訂單與停售管理",
    prefixes: ["shop:"],
  },
  {
    href: "/shop/class-orders",
    icon: Ticket,
    label: "班級訂單",
    desc: "班級代收、統計與訂單彙整",
    perms: ["class:shop_collect"],
  },
  {
    href: "/meal/vendor",
    icon: Truck,
    label: "餐商管理",
    desc: "供應商、菜單、取餐與結單設定",
    prefixes: ["meal:"],
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
                <Icon size={18} aria-hidden={true} style={{ color: "var(--info)" }} />
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
