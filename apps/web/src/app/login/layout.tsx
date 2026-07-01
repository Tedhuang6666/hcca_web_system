import { Noto_Serif_TC } from "next/font/google";

const notoSerifTC = Noto_Serif_TC({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-noto-serif-tc",
  display: "swap",
  preload: false,
});

// 登入頁使用獨立 layout，不含 Sidebar / Topbar；在此層注入 Noto Serif TC CSS variable
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <div className={notoSerifTC.variable}>{children}</div>;
}
