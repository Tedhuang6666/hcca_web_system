"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Eye, Gauge, ListTree, Plug, ShieldCheck } from "lucide-react";

const TABS = [
  { href: "/settings/navigation", label: "介面", icon: ListTree },
  { href: "/settings/notifications", label: "通知", icon: Bell },
  { href: "/settings/data-saver", label: "省流", icon: Gauge },
  { href: "/settings/privacy", label: "隱私", icon: Eye },
  { href: "/settings/security", label: "安全", icon: ShieldCheck },
  { href: "/settings/integrations", label: "整合", icon: Plug },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-col gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            SETTINGS
          </p>
          <h1 className="mt-1 text-2xl font-semibold">個人設定</h1>
        </div>
        <nav
          aria-label="設定分類"
          className="flex gap-1 overflow-x-auto rounded-lg p-1"
          style={{ background: "var(--bg-muted)", scrollbarWidth: "none" }}
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className="inline-flex min-h-10 flex-shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors"
                style={{
                  background: active ? "var(--bg-elevated)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  boxShadow: active ? "var(--shadow-sm)" : "none",
                }}
              >
                <Icon size={15} aria-hidden={true} />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>
      {children}
    </div>
  );
}
