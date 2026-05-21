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

const HIGHLIGHT_FADE_MS = 5000;
const COPY_FEEDBACK_MS = 1000;

type HashCtxValue = {
  articleId: string;
  active: boolean;
  clear: () => void;
};

const HashCtx = createContext<HashCtxValue | null>(null);

/**
 * 監聽 URL hash 是否為 `#a-{articleId}`。
 * 命中時：先平滑捲動到該條文，待捲動大致結束（最後到達時）才開啟高亮
 * （CSS .article-arrive 動畫：亮起 + 跳一下 + 緩慢褪色），5 秒後清除狀態。
 * 手動 clear 會把 hash 從 URL 上清除，避免重新整理又被觸發。
 */
function useHashHighlight(articleId: string) {
  const [active, setActive] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const targetHash = `#a-${articleId}`;
    const lightUp = () => {
      setActive(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setActive(false), HIGHLIGHT_FADE_MS);
    };
    const trigger = () => {
      const el = document.getElementById(`a-${articleId}`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const wellInView = rect.top >= vh * 0.15 && rect.bottom <= vh * 0.85;
      if (wellInView) {
        lightUp();
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // 捲動結束後才亮起 + 跳動
      window.setTimeout(lightUp, 520);
    };
    const check = () => {
      if (typeof window === "undefined") return;
      if (window.location.hash === targetHash) trigger();
    };
    check();
    // 防呆：首次 check 可能在 layout 穩定前太早執行，補一次延遲檢查。
    const retryId = window.setTimeout(check, 250);
    const onHashChange = () => check();
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.clearTimeout(retryId);
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
        className={`${className ?? ""}${active ? " article-arrive" : ""}`}
        style={style}
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
