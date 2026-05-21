import Link from "next/link";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
      <header
        className="sticky top-0 z-10"
        style={{ background: "color-mix(in srgb, var(--bg-base) 86%, transparent)", backdropFilter: "blur(10px)" }}
      >
        <div
          className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/public" className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              公開資料庫
            </Link>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              HCCA
            </span>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              href="/public/regulations"
              className="px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              法規
            </Link>
            <Link
              href="/public/documents"
              className="px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              公文
            </Link>
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}
            >
              進入系統
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">{children}</main>

      <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-10 text-xs" style={{ color: "var(--text-muted)" }}>
        <div style={{ borderTop: "1px solid var(--border)" }} className="pt-6">
          本公開入口提供法規與公開公文查詢。若需建立/審核，請登入後使用系統功能。
        </div>
      </footer>
    </div>
  );
}
