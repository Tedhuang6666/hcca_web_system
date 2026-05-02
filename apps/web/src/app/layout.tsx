import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";

export const metadata: Metadata = {
  title: "校園自治整合平台",
  description: "Campus Autonomy Integration Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="bg-[#0a0e1a] text-slate-200 antialiased">
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <Topbar />
            <main className="flex-1 overflow-y-auto p-6 animate-slide-in">
              {children}
            </main>
          </div>
        </div>
        <Toaster position="top-right" theme="dark" richColors />
      </body>
    </html>
  );
}
