import type { Metadata } from "next";

// /auth/* 頁面使用獨立 layout，不包含 Sidebar / Topbar
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
