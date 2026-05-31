"use client";

/**
 * Theme toggle 元件。
 *
 * 簡單的三按鈕切換：auto / light / dark。
 * 預期掛在 navbar 右側或 footer。
 */

import { useTheme, type ThemeChoice } from "./ThemeProvider";

const OPTIONS: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: "auto", label: "系統", icon: "🖥️" },
  { value: "light", label: "淺色", icon: "☀️" },
  { value: "dark", label: "深色", icon: "🌙" },
];

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="主題切換"
      className={`inline-flex items-center gap-1 rounded-md border bg-white p-1 dark:border-slate-700 dark:bg-slate-800 ${className}`}
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(opt.value)}
            className={
              "rounded px-2 py-1 text-sm transition " +
              (active
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700")
            }
            title={opt.label}
          >
            <span aria-hidden>{opt.icon}</span>
            <span className="ml-1 hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
