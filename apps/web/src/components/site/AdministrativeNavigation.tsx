"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/providers/ThemeProvider";

export default function AdministrativeNavigation() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  return (
    <nav className="administrative-navigation" aria-label="行政資訊導覽">
      {[{ href: "/regulations", label: "法規查詢" }, { href: "/documents", label: "公文查詢" }].map((item) => (
        <Link key={item.href} href={item.href}
          aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
      <Link href="/">返回主站</Link>
      <button type="button" onClick={() => toggleTheme()} aria-label={theme === "dark" ? "切換淺色模式" : "切換深色模式"}>
        {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
      </button>
    </nav>
  );
}
