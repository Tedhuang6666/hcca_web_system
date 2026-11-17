"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LEGAL_LINKS = [
  { href: "/system-info", label: "關於本系統" },
  { href: "/legal/privacy", label: "隱私政策" },
  { href: "/legal/terms", label: "服務條款" },
  { href: "/legal/accessibility", label: "無障礙聲明" },
  { href: "/legal/cookie", label: "Cookie 政策" },
  { href: "/legal/security-policy", label: "安全揭露政策" },
];

export default function LegalNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="法律文件導覽"
      className="mb-8 flex flex-wrap gap-2 border-b pb-4 text-sm"
      style={{ borderColor: "var(--border)" }}
    >
      {LEGAL_LINKS.map((item) => {
        const current = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded-lg px-3 transition-colors"
            style={{
              background: current ? "var(--primary-dim)" : "var(--bg-surface)",
              border: `1px solid ${current ? "var(--border-strong)" : "var(--border)"}`,
              color: current ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: current ? 600 : 400,
              textDecoration: "none",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
