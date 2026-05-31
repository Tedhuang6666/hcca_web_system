"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";

import type { RegulationArticleOut } from "@/lib/types";
import { buildArticleDisplayRows } from "@/lib/regulationStructure";

import { LawArticleRow } from "./LawArticleRow";

export interface LawTreeProps {
  articles: RegulationArticleOut[];
  /** 章節摺疊狀態（id → collapsed?）。 */
  chapterCollapsedMap?: Record<string, boolean>;
  /** 章節摺疊切換 callback。 */
  onToggleChapter?: (chapterId: string) => void;
  /** 提供每條條文的分享連結（傳入 article 回傳 URL）。 */
  shareUrlOf?: (article: RegulationArticleOut) => string | undefined;
  onCopyLink?: (url: string) => void;
  /** 高亮的條文 ID（用於從 URL 錨點導航）。 */
  highlightedId?: string | null;
  onClearHighlight?: () => void;
  /** 第一行是否顯示頂部分隔線。 */
  showFirstDivider?: boolean;
  /** 空資料時顯示的 fallback。 */
  emptyState?: ReactNode;
  /** 套用到外層容器的 className。 */
  className?: string;
}

/**
 * 唯讀的法規條文樹狀展示。
 * 適用情境：詳細頁、修正案 step 3 對照表、修訂歷程快照預覽。
 * 編輯能力（拖拉、新增、刪除）由 LawTreeEditor 提供，本元件不含。
 */
export function LawTree({
  articles,
  chapterCollapsedMap = {},
  onToggleChapter,
  shareUrlOf,
  onCopyLink,
  highlightedId = null,
  onClearHighlight,
  showFirstDivider = false,
  emptyState,
  className = "",
}: LawTreeProps) {
  const rows = useMemo(
    () => buildArticleDisplayRows(articles, chapterCollapsedMap),
    [articles, chapterCollapsedMap],
  );

  if (articles.length === 0) {
    return emptyState ? <>{emptyState}</> : (
      <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        尚無條文
      </p>
    );
  }

  return (
    <div className={className}>
      {rows.map((row, idx) => {
        const isFirst = idx === 0;
        const shareUrl = shareUrlOf?.(row.article);
        return (
          <LawArticleRow
            key={row.article.id}
            article={row.article}
            badge={row.displayLabel}
            chapterCollapsed={chapterCollapsedMap[row.article.id] ?? false}
            hiddenByChapter={row.hiddenByChapter}
            onToggleChapter={onToggleChapter ? () => onToggleChapter(row.article.id) : undefined}
            shareUrl={shareUrl}
            onCopyLink={onCopyLink}
            showTopDivider={!isFirst || showFirstDivider}
            highlighted={highlightedId === row.article.id}
            onClearHighlight={highlightedId === row.article.id ? onClearHighlight : undefined}
          />
        );
      })}
    </div>
  );
}
