// /auth/* 頁面使用獨立 layout，不包含 Sidebar / Topbar
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
