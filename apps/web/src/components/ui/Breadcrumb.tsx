"use client";
import Link from "next/link";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="麵包屑導覽" className="flex items-center gap-1 text-xs flex-wrap no-print">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" className="flex-shrink-0"
                style={{ color: "var(--text-disabled)" }} aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}
            {item.href && !isLast ? (
              <Link href={item.href}
                className="transition-colors hover:opacity-80"
                style={{ color: "var(--text-muted)", textDecoration: "none" }}>
                {item.label}
              </Link>
            ) : (
              <span style={{ color: isLast ? "var(--text-primary)" : "var(--text-muted)", fontWeight: isLast ? 500 : 400 }}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
