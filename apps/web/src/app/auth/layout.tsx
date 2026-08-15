import type { Metadata } from "next";
import PerformanceProvider from "@/components/providers/PerformanceProvider";

// /auth/* 頁面使用獨立 layout，不包含 Sidebar / Topbar
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <PerformanceProvider>{children}</PerformanceProvider>;
}
