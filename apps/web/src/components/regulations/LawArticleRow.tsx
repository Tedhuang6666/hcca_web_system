"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import type { RegulationArticleOut } from "@/lib/types";
import {
  ARTICLE_TYPE_META,
  ARTICLE_IS_STRUCTURAL,
  normalizeArticleType,
} from "@/lib/regulationStructure";
import CopyButton from "@/components/ui/CopyButton";
import { SmartLinkedText } from "@/components/ui/OfficialText";

export interface LawArticleRowProps {
  article: RegulationArticleOut;
  /** 預先計算好的徽章文字（例：「第 1 章」）。 */
  badge: string;
  /** 章節是否被摺疊（影響子內容是否顯示）。 */
  chapterCollapsed?: boolean;
  /** 是否因上級章節摺疊而被隱藏。 */
  hiddenByChapter?: boolean;
  /** 章節摺疊切換 callback。 */
  onToggleChapter?: () => void;
  shareUrl?: string;
  onCopyLink?: (url: string) => void;
  showTopDivider?: boolean;
  highlighted?: boolean;
  onClearHighlight?: () => void;
  /** 編輯模式：傳入則會在 hover/focus 時顯示更明顯的互動樣式。 */
  interactive?: boolean;
  /** 點擊整行的 callback（編輯模式專用）。 */
  onSelect?: () => void;
  /** 拖拉模式專用：左側放置 drag handle node。 */
  dragHandle?: ReactNode;
  /** 拖拉模式專用：右側放置操作按鈕。 */
  actions?: ReactNode;
  /** 額外 className（拖拉狀態用）。 */
  className?: string;
  /** 額外 style（拖拉時的 transform 等）。 */
  style?: CSSProperties;
  /** Tabindex 控制（鍵盤導航用）。 */
  tabIndex?: number;
  /** 鍵盤事件透傳。 */
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Aria-grabbed 等屬性透傳。 */
  rowProps?: React.HTMLAttributes<HTMLDivElement>;
}

const CLOSE_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/**
 * 單一條文行（唯讀展示）。
 * 同時被詳細頁、編輯頁、修正案頁使用，保證視覺一致。
 * 編輯能力（拖拉、編輯按鈕）由父元件透過 dragHandle / actions slot 注入。
 */
export function LawArticleRow({
  article,
  badge,
  chapterCollapsed = false,
  hiddenByChapter = false,
  onToggleChapter,
  shareUrl,
  onCopyLink,
  showTopDivider = true,
  highlighted = false,
  onClearHighlight,
  interactive = false,
  onSelect,
  dragHandle,
  actions,
  className = "",
  style,
  tabIndex,
  onKeyDown,
  rowProps,
}: LawArticleRowProps) {
  if (hiddenByChapter) return null;

  const normalizedType = normalizeArticleType(article.article_type);
  const meta = ARTICLE_TYPE_META[normalizedType];
  const isStructural = ARTICLE_IS_STRUCTURAL[normalizedType] ?? false;
  const isFrozen = Boolean(article.frozen_by);
  const isDeleted = article.is_deleted;
  const stableAnchorId = `a-${article.id}`;

  // 縮排：響應式 — 桌面用 indentDesktop，手機用 indentMobile
  // 透過 CSS clamp 在兩者之間補間
  const indentStyle: CSSProperties = {
    paddingLeft: `clamp(${meta.indentMobile + 12}px, ${4 + (meta.indentDesktop / 6)}vw, ${meta.indentDesktop + 16}px)`,
  };

  const borderStyle: CSSProperties = {
    borderLeft: `${meta.borderWidth}px solid ${meta.borderColor}`,
  };

  const frozenBg: CSSProperties = isFrozen
    ? { background: "rgba(251,146,60,0.05)" }
    : {};
  const deletedStyle: CSSProperties = isDeleted
    ? { opacity: 0.45, textDecoration: "line-through" }
    : {};
  const dividerStyle: CSSProperties = showTopDivider
    ? { borderTop: "1px solid var(--border)" }
    : {};
  // 到達高亮：套用全域 .article-arrive（亮起 + 跳一下 + 緩慢褪色），
  // 視覺由 CSS keyframes 控制，這裡不再寫 inline 背景樣式。
  const highlightClass = highlighted ? " article-arrive" : "";

  const interactiveStyle: CSSProperties = interactive
    ? { cursor: onSelect ? "pointer" : "default" }
    : {};

  // onCopyLink 存在才提供複製；按鈕本身完成複製並就地顯示結果，右鍵複製仍交給呼叫端提示。
  const copyButton = shareUrl && onCopyLink ? (
    <CopyButton
      value={shareUrl}
      icon="link"
      iconSize={12}
      announcement={`${badge}連結已複製`}
      onClick={(event) => event.stopPropagation()}
      className="law-row-copy-link no-print inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md transition-[color,background-color,border-color,opacity,transform]"
      style={{ color: "var(--text-muted)", border: "1px solid var(--border)", background: "transparent" }}
      title="複製此條連結"
      aria-label={`複製${badge}連結`}
    />
  ) : null;

  const clearHighlightButton = highlighted && onClearHighlight ? (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClearHighlight();
      }}
      className="no-print inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md transition-opacity hover:opacity-80"
      style={{ color: "var(--primary-text)", border: "1px solid var(--border-strong)", background: "var(--bg-surface)" }}
      title="關閉高亮"
      aria-label="關閉高亮"
    >
      {CLOSE_ICON}
    </button>
  ) : null;

  const copyOnContextMenu = shareUrl && onCopyLink
    ? (event: MouseEvent) => {
        event.preventDefault();
        onCopyLink(shareUrl);
      }
    : undefined;

  const badgeChip = (
    <span
      className="law-row-badge inline-flex flex-shrink-0 items-center justify-center px-2 py-0.5 rounded-md text-xs font-semibold tracking-wide"
      style={{
        background: meta.badgeBg,
        color: meta.badgeColor,
        border: `1px solid ${meta.borderColor}`,
        minWidth: isStructural ? "auto" : "5em",
      }}
    >
      {shareUrl ? (
        <a href={shareUrl} className="rounded-sm" style={{ color: "inherit" }} title={`${badge}連結`}>
          {badge}
        </a>
      ) : (
        <span>{badge}</span>
      )}
    </span>
  );

  const statusChips = (
    <>
      {isDeleted && (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-normal"
          style={{ color: "var(--danger)", background: "rgba(220,38,38,0.1)", textDecoration: "none" }}
        >
          已刪除
        </span>
      )}
      {isFrozen && !isDeleted && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-normal"
          style={{
            color: "#fb923c",
            background: "rgba(251,146,60,0.12)",
            border: "1px solid rgba(251,146,60,0.3)",
          }}
        >
          <AlertTriangle size={10} strokeWidth={2.2} aria-hidden="true" />
          凍結
        </span>
      )}
    </>
  );

  // ── 章節（結構性層級）：volume / chapter / section / special_clause ──
  if (isStructural) {
    return (
      <div
        id={stableAnchorId}
        onContextMenu={copyOnContextMenu}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        tabIndex={tabIndex}
        className={`law-row law-row-structural scroll-mt-20 ${className}${highlightClass}`}
        style={{
          ...dividerStyle,
          ...frozenBg,
          ...borderStyle,
          ...indentStyle,
          ...interactiveStyle,
          marginTop: showTopDivider ? "0.25rem" : 0,
          paddingTop: "0.55rem",
          paddingRight: "0.75rem",
          paddingBottom: "0.55rem",
          ...style,
        }}
        {...rowProps}
      >
        <div className="law-row-shell">
          {dragHandle && <div className="flex-shrink-0 pt-0.5">{dragHandle}</div>}
          <div className="flex flex-1 min-w-0 flex-wrap items-center gap-2" style={deletedStyle}>
            {badgeChip}
            <span
              className={`${meta.textSize} ${meta.fontWeight}`}
              style={{ color: "var(--text-primary)" }}
            >
              <SmartLinkedText text={article.title || "（未命名章節）"} />
            </span>
            {statusChips}
            {isFrozen && !isDeleted && article.frozen_by && (
              <span
                className="text-xs"
                style={{ color: "#fb923c" }}
                title={`凍結原因：${article.frozen_by}`}
              >
                {article.frozen_by}
              </span>
            )}
            {copyButton}
            {clearHighlightButton}
            {normalizedType === "chapter" && onToggleChapter && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleChapter();
                }}
                className="no-print text-xs px-2 py-0.5 rounded-full"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
              >
                {chapterCollapsed ? "展開本章" : "收合本章"}
              </button>
            )}
          </div>
          {actions && <div className="law-row-actions">{actions}</div>}
        </div>
      </div>
    );
  }

  // ── 條文（article）：編號 + 內文，橫向排列 ──
  if (normalizedType === "article") {
    return (
      <div
        id={stableAnchorId}
        onContextMenu={copyOnContextMenu}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        tabIndex={tabIndex}
        className={`law-row law-row-article scroll-mt-20 ${className}${highlightClass}`}
        style={{
          ...dividerStyle,
          ...frozenBg,
          ...borderStyle,
          ...indentStyle,
          ...interactiveStyle,
          paddingTop: "0.45rem",
          paddingRight: "0.75rem",
          paddingBottom: "0.45rem",
          lineHeight: "1.7",
          ...style,
        }}
        {...rowProps}
      >
        <div className="law-row-shell">
          {dragHandle && <div className="flex-shrink-0 pt-0.5">{dragHandle}</div>}
          <div className="flex flex-1 min-w-0 flex-col gap-1 sm:flex-row sm:gap-2" style={deletedStyle}>
            <div className="flex flex-wrap items-center gap-1.5 sm:flex-shrink-0">
              {badgeChip}
              {article.subtitle && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {article.subtitle}
                </span>
              )}
              {statusChips}
              {copyButton}
              {clearHighlightButton}
            </div>
            <div className="flex-1 min-w-0">
              <span
                className={`${meta.textSize} ${meta.fontWeight}`}
                style={{ color: "var(--text-primary)", whiteSpace: "pre-wrap" }}
              >
                <SmartLinkedText text={article.title && !article.content ? article.title : (article.content ?? "")} />
              </span>
              {isFrozen && !isDeleted && article.frozen_by && (
                <div className="mt-1 flex items-start gap-1 text-xs" style={{ color: "#fb923c" }}>
                  <AlertTriangle size={12} strokeWidth={2.2} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <span
                    style={{
                      background: "rgba(251,146,60,0.08)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      border: "1px solid rgba(251,146,60,0.25)",
                    }}
                  >
                    凍結：{article.frozen_by}
                  </span>
                </div>
              )}
            </div>
          </div>
          {actions && <div className="law-row-actions">{actions}</div>}
        </div>
      </div>
    );
  }

  // ── 項款目（paragraph / subparagraph / item）：縮排逐級加大，小字 ──
  return (
    <div
      id={stableAnchorId}
      onContextMenu={copyOnContextMenu}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      tabIndex={tabIndex}
      className={`law-row law-row-clause scroll-mt-20 ${className}${highlightClass}`}
      style={{
        ...dividerStyle,
        ...frozenBg,
        ...borderStyle,
        ...indentStyle,
        ...interactiveStyle,
        paddingTop: "0.35rem",
        paddingRight: "0.75rem",
        paddingBottom: "0.35rem",
        lineHeight: "1.65",
        ...style,
      }}
      {...rowProps}
    >
      <div className="law-row-shell">
        {dragHandle && <div className="flex-shrink-0 pt-0.5">{dragHandle}</div>}
        <div className="flex flex-1 min-w-0 flex-col gap-1 sm:flex-row sm:gap-2" style={deletedStyle}>
          <div className="flex flex-wrap items-center gap-1.5 sm:flex-shrink-0">
            {badgeChip}
            {statusChips}
            {copyButton}
            {clearHighlightButton}
          </div>
          <span
            className={`flex-1 min-w-0 ${meta.textSize} ${meta.fontWeight}`}
            style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}
          >
            {chapterCollapsed ? "" : <SmartLinkedText text={article.content ?? article.title ?? ""} />}
          </span>
        </div>
        {actions && <div className="law-row-actions">{actions}</div>}
      </div>
    </div>
  );
}
