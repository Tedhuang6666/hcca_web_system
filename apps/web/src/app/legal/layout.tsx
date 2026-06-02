import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "法律專區 · HCCA 校園自治平台",
  description: "隱私政策、服務條款、無障礙聲明、安全揭露政策",
};

const LEGAL_LINKS = [
  { href: "/about", label: "關於本系統" },
  { href: "/legal/privacy", label: "隱私政策" },
  { href: "/legal/terms", label: "服務條款" },
  { href: "/legal/accessibility", label: "無障礙聲明" },
  { href: "/legal/cookie", label: "Cookie 政策" },
  { href: "/legal/security-policy", label: "安全揭露政策" },
];

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 lg:py-14">
      <nav
        aria-label="法律文件導覽"
        className="mb-8 flex flex-wrap gap-2 border-b pb-4 text-sm"
        style={{ borderColor: "var(--border)" }}
      >
        {LEGAL_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded px-3 py-1 transition-colors"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              textDecoration: "none",
            }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <article className="prose prose-slate max-w-none">{children}</article>
      <footer
        className="mt-12 border-t pt-4 text-xs"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
      >
        <p>
          若對本政策有疑問，請透過平台管理員或班聯會指定窗口聯繫。
          安全漏洞回報請見{" "}
          <Link className="underline" href="/legal/security-policy" style={{ color: "var(--primary-text)" }}>
            安全揭露政策
          </Link>
          。
        </p>
      </footer>
    </div>
  );
}
