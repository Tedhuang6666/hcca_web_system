import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

export type ToolLink = { href: string; label: string; icon: LucideIcon };

/** 管理工具清單：一列一個入口，名稱即說明，不另加介紹文字。 */
export default function ToolLinkList({ tools }: { tools: ToolLink[] }) {
  return (
    <ul className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map(({ href, label, icon: Icon }) => (
        <li key={href} style={{ borderBottom: "1px solid var(--border)" }}>
          <Link
            href={href}
            className="flex min-h-12 items-center gap-3 rounded-md px-2 text-sm font-medium transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-primary)", textDecoration: "none" }}
          >
            <Icon size={16} aria-hidden={true} style={{ color: "var(--text-muted)" }} />
            <span className="min-w-0 flex-1">{label}</span>
            <ChevronRight size={15} aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
