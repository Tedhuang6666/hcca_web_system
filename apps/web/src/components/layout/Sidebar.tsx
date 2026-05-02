"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", icon: "⊞", label: "儀表板" },
  { href: "/documents", icon: "📄", label: "公文系統" },
  { href: "/documents/new", icon: "✏️", label: "新增公文" },
  { href: "/shop", icon: "🛍️", label: "訂購系統" },
  { href: "/regulations", icon: "📋", label: "法規查詢" },
  { href: "/notifications", icon: "🔔", label: "通知中心" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col h-full border-r"
      style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>

      {/* Logo */}
      <div className="px-5 py-6 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ background: "var(--accent-dim)", border: "1px solid var(--border-glow)", color: "var(--accent)" }}>
            自
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">校園自治</p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>整合平台</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, icon, label }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200
                ${active
                  ? "text-sky-300 font-medium"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                }`}
              style={active ? {
                background: "var(--accent-dim)",
                border: "1px solid var(--border-glow)",
              } : {}}>
              <span className="text-base">{icon}</span>
              <span>{label}</span>
              {active && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full animate-pulse-slow"
                  style={{ background: "var(--accent)" }} />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: "rgba(56,189,248,0.2)", color: "var(--accent)" }}>
            U
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-300 truncate">使用者</p>
            <p className="text-xs truncate" style={{ color: "var(--muted)" }}>學生會員</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
