"use client";

import type { ComponentProps } from "react";
import { Link2, X } from "lucide-react";
import { SmartLinkedText } from "@/components/ui/OfficialText";
import type { ArticleRow } from "./RegulationDetailSections";

/** 法規閱讀與條文引用。 */
export default function LawReadingRow({ article, displayLabel, hidden, shareUrl, chapterCollapsed, onToggleChapter,
  onCopyLink, highlighted, onClearHighlight }: ComponentProps<typeof ArticleRow>) {
  if (hidden) return null;
  const structural = ["volume", "chapter", "section"].includes(article.article_type);
  const content = article.content || article.title || "";
  return (
    <section id={`a-${article.id}`} data-kind={article.article_type}
      className={`law-reading-row${structural ? " law-reading-heading" : ""}${highlighted ? " law-reading-highlight" : ""}${article.is_deleted ? " law-reading-deleted" : ""}`}>
      {structural ? (
        <div className="law-reading-heading-line">
        {
        article.article_type === "section"
          ? <h3>{displayLabel}　<SmartLinkedText text={article.title || ""} /></h3>
          : <h2>{displayLabel}　<SmartLinkedText text={article.title || ""} /></h2>
        }
        {article.article_type === "chapter" && onToggleChapter && <button type="button"
          className="law-reading-chapter-toggle no-print" aria-expanded={!chapterCollapsed}
          onClick={onToggleChapter}>{chapterCollapsed ? "展開本章" : "收合本章"}</button>}
        </div>
      ) : (
        <>
          <div className="law-reading-number">
            {shareUrl ? <a href={shareUrl} aria-label={`${displayLabel}引用連結`}>{displayLabel}</a> : displayLabel}
            {article.subtitle && <span>{article.subtitle}</span>}
          </div>
          <div className="law-reading-text"><SmartLinkedText text={content} /></div>
        </>
      )}
      {article.is_deleted && <p className="law-reading-notice">（刪除）</p>}
      {article.frozen_by && <p className="law-reading-notice">凍結：{article.frozen_by}</p>}
      <div className="law-reading-actions no-print">
        {(structural || article.article_type === "article") && shareUrl && onCopyLink && <button type="button" onClick={() => onCopyLink(shareUrl)} aria-label={`複製${displayLabel}連結`} title={`複製${displayLabel}連結`}><Link2 size={15} aria-hidden="true" /></button>}
        {highlighted && onClearHighlight && <button type="button" onClick={onClearHighlight} aria-label="關閉高亮"><X size={15} aria-hidden="true" /></button>}
      </div>
    </section>
  );
}
