"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { flushSync } from "react-dom";

export type Theme = "light" | "dark";

export interface ThemeTransitionOrigin {
  x: number;
  y: number;
  target?: HTMLElement;
}

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
const THEME_STORAGE_KEY = "hcca-theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme, origin?: ThemeTransitionOrigin) => void;
  toggleTheme: (origin?: ThemeTransitionOrigin) => void;
  a11y: A11ySettings;
  setA11y: (key: keyof A11ySettings, value: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

type ThemeViewTransition = {
  finished: Promise<void>;
};

type DocumentWithViewTransition = Document & {
  startViewTransition?: (update: () => void) => ThemeViewTransition;
};

function shouldReduceThemeMotion(a11yMotion: boolean) {
  return a11yMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hasReliableThemeTransitionOrigin() {
  // iOS/iPadOS WebKit can offset the snapshot when browser chrome moves or the page scrolls.
  const isTouchWebKit = navigator.maxTouchPoints > 0
    && CSS.supports("-webkit-touch-callout", "none");
  return !isTouchWebKit;
}

function animateThemeToggleControl(target: HTMLElement) {
  window.requestAnimationFrame(() => {
    const icon = target.querySelector("svg");
    if (!icon) return;

    icon.animate(
      [
        { opacity: 0.45, transform: "scale(0.72) rotate(-12deg)" },
        { opacity: 1, transform: "scale(1) rotate(0deg)" },
      ],
      { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
  });
}

interface ThemeTransitionStyle {
  root: HTMLElement;
  previous: Record<string, string>;
}

function installThemeTransitionStyles(
  x: number,
  y: number,
  radius: number,
): ThemeTransitionStyle {
  const root = document.documentElement;
  const properties = {
    "--theme-transition-x": `${x}px`,
    "--theme-transition-y": `${y}px`,
    "--theme-transition-radius": `${radius}px`,
  };
  const previous = Object.fromEntries(
    Object.keys(properties).map((property) => [property, root.style.getPropertyValue(property)]),
  );

  for (const [property, value] of Object.entries(properties)) {
    root.style.setProperty(property, value);
  }
  return { root, previous };
}

function clearThemeTransition(style: ThemeTransitionStyle) {
  for (const [property, value] of Object.entries(style.previous)) {
    if (value) style.root.style.setProperty(property, value);
    else style.root.style.removeProperty(property);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [a11y, setA11yState] = useState<A11ySettings>(A11Y_DEFAULT);

  // ── 初始化 theme（從 localStorage 或系統偏好） ──────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    const nextTheme = saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

    setThemeState(nextTheme);
    applyTheme(nextTheme);
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

  // ── 同步 a11y 至 DOM + localStorage ────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-a11y-contrast", String(a11y.contrast));
    root.setAttribute("data-a11y-large", String(a11y.large));
    root.setAttribute("data-a11y-motion", String(a11y.motion));
    localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(a11y));
  }, [a11y]);

  const setTheme = useCallback((t: Theme, origin?: ThemeTransitionOrigin) => {
    const startViewTransition = (document as DocumentWithViewTransition).startViewTransition;
    const shouldReduceMotion = shouldReduceThemeMotion(a11y.motion);
    const canRevealFromOrigin = hasReliableThemeTransitionOrigin();

    if (!origin || !startViewTransition || shouldReduceMotion || !canRevealFromOrigin) {
      setThemeState(t);
      applyTheme(t);
      if (origin?.target && !shouldReduceMotion) animateThemeToggleControl(origin.target);
      return;
    }

    const x = Math.min(Math.max(origin.x, 0), window.innerWidth);
    const y = Math.min(Math.max(origin.y, 0), window.innerHeight);
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    const transitionStyle = installThemeTransitionStyles(x, y, radius);

    try {
      const transition = startViewTransition.call(document, () => {
        flushSync(() => {
          setThemeState(t);
          applyTheme(t);
        });
      });
      void transition.finished.then(
        () => clearThemeTransition(transitionStyle),
        () => clearThemeTransition(transitionStyle),
      );
    } catch {
      clearThemeTransition(transitionStyle);
      setThemeState(t);
      applyTheme(t);
    }
  }, [a11y.motion]);
  const toggleTheme = useCallback(
    (origin?: ThemeTransitionOrigin) => {
      const nextTheme = theme === "dark" ? "light" : "dark";
      setTheme(nextTheme, origin);
    },
    [setTheme, theme],
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
