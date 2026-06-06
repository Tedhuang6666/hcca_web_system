"use client";

/**
 * Theme provider for light, dark, and system modes.
 *
 * 設計：
 * - 三態：auto / light / dark
 * - auto 模式跟系統 prefers-color-scheme
 * - 使用 localStorage 保留使用者偏好
 * - 不依賴第三方套件（next-themes），保持 bundle 小
 *
 * 用法：
 *   <ThemeProvider><App /></ThemeProvider>
 *   const { theme, setTheme, effective } = useTheme();
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeChoice = "auto" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

interface ThemeContextValue {
  theme: ThemeChoice;
  effective: EffectiveTheme;
  setTheme: (next: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "hcca_theme";

function readStored(): ThemeChoice {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
  return stored === "light" || stored === "dark" || stored === "auto"
    ? stored
    : "auto";
}

function systemPref(): EffectiveTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyToHtml(effective: EffectiveTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (effective === "dark") {
    root.classList.add("dark");
    root.dataset.theme = "dark";
  } else {
    root.classList.remove("dark");
    root.dataset.theme = "light";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>("auto");
  const [systemEffective, setSystemEffective] = useState<EffectiveTheme>("light");

  // 初次掛載：讀 localStorage + 訂閱系統偏好
  useEffect(() => {
    setThemeState(readStored());
    setSystemEffective(systemPref());

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      setSystemEffective(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const effective: EffectiveTheme = useMemo(
    () => (theme === "auto" ? systemEffective : theme),
    [theme, systemEffective],
  );

  // 套用到 <html>
  useEffect(() => {
    applyToHtml(effective);
  }, [effective]);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const value = useMemo(
    () => ({ theme, effective, setTheme }),
    [theme, effective, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}
