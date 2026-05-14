// 登入頁使用獨立 layout，不包含 Sidebar / Topbar
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
