import Link from "next/link";

import { BRANDING } from "@/lib/branding";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center flex flex-col items-center gap-4 max-w-sm">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" className="opacity-40" style={{ color: "var(--text-muted)" }}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" strokeDasharray="2 2" />
        </svg>
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            找不到此頁面
          </h2>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            您要尋找的 {BRANDING.acronym} 頁面不存在或已被移除。
          </p>
        </div>
        <Link href="/" className="btn btn-primary">返回首頁</Link>
      </div>
    </div>
  );
}
