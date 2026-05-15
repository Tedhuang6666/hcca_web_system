"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

const HIGHLIGHT_FADE_MS = 3000;
const COPY_FEEDBACK_MS = 1000;

type HashCtxValue = {
  articleId: string;
  active: boolean;
  clear: () => void;
};

const HashCtx = createContext<HashCtxValue | null>(null);

/**
 * 監聽 URL hash 是否為 `#a-{articleId}`。
 * 命中時：開啟高亮、平滑捲動到中央（若不在視窗內）、3 秒後自動褪色。
 * 手動 clear 會同時把 hash 從 URL 上清除，避免重新整理又被觸發。
 */
function useHashHighlight(articleId: string) {
  const [active, setActive] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const targetHash = `#a-${articleId}`;
    const trigger = () => {
      setActive(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setActive(false), HIGHLIGHT_FADE_MS);
      const el = document.getElementById(`a-${articleId}`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const alreadyInView = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!alreadyInView) {
        requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "center" }));
      }
    };
    const check = () => {
      if (typeof window !== "undefined" && window.location.hash === targetHash) trigger();
    };
    check();
    window.addEventListener("hashchange", check);
    return () => {
      window.removeEventListener("hashchange", check);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [articleId]);

  const clear = useCallback(() => {
    setActive(false);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (typeof window !== "undefined" && window.location.hash === `#a-${articleId}`) {
      const { pathname, search } = window.location;
      window.history.replaceState(null, "", `${pathname}${search}`);
    }
  }, [articleId]);

  return { active, clear };
}

export function ArticleHashWrapper({
  articleId,
  className,
  style,
  children,
}: {
  articleId: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { active, clear } = useHashHighlight(articleId);
  return (
    <HashCtx.Provider value={{ articleId, active, clear }}>
      <div
        id={`a-${articleId}`}
        className={className}
        style={{
          transition: "background 600ms ease, box-shadow 600ms ease",
          ...style,
          ...(active && {
            background: "rgba(14,165,233,0.12)",
            boxShadow: "inset 0 0 0 1px rgba(14,165,233,0.45)",
          }),
        }}
      >
        {children}
      </div>
    </HashCtx.Provider>
  );
}

export function ArticleCopyButton({ ariaLabel }: { ariaLabel?: string } = {}) {
  const ctx = useContext(HashCtx);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  if (!ctx) return null;
  const { articleId } = ctx;

  const onClick = async (event: MouseEvent) => {
    event.stopPropagation();
    if (typeof window === "undefined") return;
    const { origin, pathname, search } = window.location;
    const url = `${origin}${pathname}${search}#a-${articleId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch {
      // 公開頁不引入 toast；失敗時悄悄忽略
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="no-print inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-all"
      style={{
        color: copied ? "#10b981" : "var(--text-muted)",
        border: `1px solid ${copied ? "rgba(16,185,129,0.4)" : "var(--border)"}`,
        background: copied ? "rgba(16,185,129,0.08)" : "transparent",
        transform: copied ? "scale(1.06)" : "scale(1)",
      }}
      title={copied ? "已複製" : "複製此條連結"}
      aria-label={ariaLabel ?? "複製條文連結"}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )}
    </button>
  );
}

export function ArticleClearHighlightButton() {
  const ctx = useContext(HashCtx);
  if (!ctx?.active) return null;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        ctx.clear();
      }}
      className="no-print inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-opacity hover:opacity-80"
      style={{
        color: "var(--primary)",
        border: "1px solid var(--border-strong)",
        background: "var(--bg-surface)",
      }}
      title="關閉高亮"
      aria-label="關閉高亮"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
