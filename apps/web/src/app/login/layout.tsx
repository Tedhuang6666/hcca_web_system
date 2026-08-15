import type { Metadata } from "next";
import PerformanceProvider from "@/components/providers/PerformanceProvider";

// Login consumes the per-request CSP nonce from proxy.ts; never emit it as a
// build-time static page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

// 登入頁使用獨立 layout，不含 Sidebar / Topbar；字型採用全域系統 serif fallback，
// 避免 next/font 在 per-request CSP 下插入沒有 nonce 的 inline <style>。
import "../login.css";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <PerformanceProvider><div>{children}</div></PerformanceProvider>;
}
