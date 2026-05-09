"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export interface A11ySettings {
  /** 高對比模式：增強文字與背景對比度 */
  contrast: boolean;
  /** 大字體模式：放大全站文字 */
  large: boolean;
  /** 減少動態效果：停用動畫與過場特效 */
  motion: boolean;
}

const A11Y_DEFAULT: A11ySettings = { contrast: false, large: false, motion: false };
const A11Y_STORAGE_KEY = "hcca-a11y";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  a11y: A11ySettings;
  setA11y: (key: keyof A11ySettings, value: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [a11y, setA11yState] = useState<A11ySettings>(A11Y_DEFAULT);

  // ── 初始化 theme（從 localStorage 或系統偏好） ──────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("hcca-theme") as Theme | null;
    if (saved === "light" || saved === "dark") {
      setThemeState(saved);
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setThemeState(prefersDark ? "dark" : "light");
    }
  }, []);

  // ── 初始化 a11y（從 localStorage） ────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(A11Y_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<A11ySettings>;
        setA11yState({
          contrast: parsed.contrast ?? false,
          large: parsed.large ?? false,
          motion: parsed.motion ?? false,
        });
      }
    } catch {
      // 損壞的 JSON → 維持預設值
    }
  }, []);

  // ── 同步 theme 至 DOM ───────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("hcca-theme", theme);
  }, [theme]);

  // ── 同步 a11y 至 DOM + localStorage ────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-a11y-contrast", String(a11y.contrast));
    root.setAttribute("data-a11y-large", String(a11y.large));
    root.setAttribute("data-a11y-motion", String(a11y.motion));
    localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(a11y));
  }, [a11y]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === "dark" ? "light" : "dark")),
    [],
  );
  const setA11y = useCallback((key: keyof A11ySettings, value: boolean) => {
    setA11yState((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, a11y, setA11y }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
