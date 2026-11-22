"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  ArticleType,
  RegulationArticleOut,
  RegulationRevisionOut,
} from "@/lib/types";
import {
  ARTICLE_TYPE_LABEL,
  buildArticleDisplayRows as buildDisplayRowsFn,
} from "@/lib/regulationStructure";
import { formatRevisionDate } from "@/lib/regulationHistory";

import { LawArticleRow } from "./LawArticleRow";

export type Tab = "content" | "history" | "revisions";

export function isTab(value: string | null): value is Tab {
  return value === "content" || value === "history" || value === "revisions";
}

type ArticleDisplayRow = {
  article: RegulationArticleOut;
  displayLabel: string;
  hiddenByChapter: boolean;
};

type RevisionSnapshotArticle = {
  id: string;
  article_type: ArticleType;
  title: string;
  content: string | null;
  legal_number?: string | null;
};

export function buildArticleDisplayRows(
  articles: RegulationArticleOut[],
  chapterCollapsedMap: Record<string, boolean>,
): ArticleDisplayRow[] {
  return buildDisplayRowsFn(articles, chapterCollapsedMap) as ArticleDisplayRow[];
}

function parseRevisionArticleSnapshot(snapshot: string | null | undefined): RevisionSnapshotArticle[] {
  if (!snapshot) return [];
  try {
    const parsed = JSON.parse(snapshot) as RevisionSnapshotArticle[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const PROSE = "prose max-w-none";

// ── 條文列（thin wrapper，沿用 LawArticleRow 視覺）────────────────────────────

export function ArticleRow({
  article,
  displayLabel,
  hidden = false,
  chapterCollapsed = false,
  onToggleChapter,
  shareUrl,
  onCopyLink,
  showTopDivider = true,
  highlighted = false,
  onClearHighlight,
}: {
  article: RegulationArticleOut;
  displayLabel: string;
  hidden?: boolean;
  chapterCollapsed?: boolean;
  onToggleChapter?: (() => void) | null;
  shareUrl?: string;
  onCopyLink?: (url: string) => void;
  showTopDivider?: boolean;
  highlighted?: boolean;
  onClearHighlight?: () => void;
}) {
  return (
    <LawArticleRow
      article={article}
      badge={displayLabel}
      chapterCollapsed={chapterCollapsed}
      hiddenByChapter={hidden}
      onToggleChapter={onToggleChapter ?? undefined}
      shareUrl={shareUrl}
      onCopyLink={onCopyLink}
      showTopDivider={showTopDivider}
      highlighted={highlighted}
      onClearHighlight={onClearHighlight}
    />
  );
}

// ── 修訂歷程卡 ────────────────────────────────────────────────────────────────

export function RevisionCard({
  rev, prevRev, currentRev, onDiff,
}: {
  rev: RegulationRevisionOut;
  prevRev: RegulationRevisionOut | null;
  currentRev: RegulationRevisionOut | null;
  onDiff: (a: RegulationRevisionOut, b: RegulationRevisionOut | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLatest = !currentRev || rev.id === currentRev.id;
  const snapshotArticles = useMemo(
    () => parseRevisionArticleSnapshot(rev.article_snapshot),
    [rev.article_snapshot],
  );

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
          style={{ background: "var(--primary-dim)", color: "var(--primary-text)", border: "1px solid var(--border-strong)" }}>
          v{rev.version}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{rev.change_brief}</span>
            {rev.is_total_amendment && (
              <span className="text-xs px-1.5 py-0.5 rounded"
                style={{ color: "#f59e0b", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)" }}>
                全文修訂
              </span>
            )}
            {isLatest && (
              <span className="text-xs px-1.5 py-0.5 rounded"
                style={{ color: "var(--success)", background: "var(--success-dim)", border: "1px solid rgba(34,197,94,0.25)" }}>
                最新版本
              </span>
            )}
          </div>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {formatRevisionDate(rev)}
          </p>
          {rev.published_document_id && (
            <div className="mt-1 flex flex-col items-start gap-0.5 text-xs">
              <Link
                href={`/documents/${rev.published_document_id}`}
                className="inline-flex hover:opacity-80"
                style={{ color: "var(--primary-text)" }}
              >
                查看公布公文 →
              </Link>
              {rev.published_document_summary?.trim() && (
                <span className="whitespace-pre-wrap" style={{ color: "var(--text-muted)" }}>
                  摘要：{rev.published_document_summary}
                </span>
              )}
            </div>
          )}
          {rev.resolution_link && (
            <a href={rev.resolution_link} target="_blank" rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-opacity hover:opacity-80"
              style={{ color: "var(--primary-text)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
              查看決議文
            </a>
          )}
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0 items-end">
          {rev.content_snapshot && prevRev?.content_snapshot && (
            <button onClick={() => onDiff(prevRev, rev)}
              className="text-xs px-2.5 py-1 rounded-lg transition-[color,background-color,border-color,opacity,box-shadow,transform] hover:opacity-80"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
              ↔ 與前版比較
            </button>
          )}
          {rev.content_snapshot && currentRev && !isLatest && (
            <button onClick={() => onDiff(rev, currentRev)}
              className="text-xs px-2.5 py-1 rounded-lg transition-[color,background-color,border-color,opacity,box-shadow,transform] hover:opacity-80"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
              ↔ 與最新版比較
            </button>
          )}
          {rev.content_snapshot && (
            <button onClick={() => setExpanded(p => !p)}
              className="text-xs px-2.5 py-1 rounded-lg transition-[color,background-color,border-color,opacity,box-shadow,transform] hover:opacity-80"
              style={{ color: "var(--primary-text)", border: "1px solid var(--border-strong)", background: "var(--primary-dim)" }}>
              {expanded ? "▲ 收起" : "▼ 查看快照"}
            </button>
          )}
        </div>
      </div>
      {expanded && (snapshotArticles.length > 0 || rev.content_snapshot) && (
        <div
          className="mt-3 pt-3 border-t max-h-72 overflow-y-auto space-y-2"
          style={{ borderColor: "var(--border)" }}
        >
          {snapshotArticles.length > 0 ? snapshotArticles.map((article) => {
            const label = article.article_type === "article"
              ? `第 ${article.legal_number ?? "?"} 條`
              : article.legal_number
                ? `${article.legal_number} ${ARTICLE_TYPE_LABEL[article.article_type] ?? article.article_type}`
                : `${ARTICLE_TYPE_LABEL[article.article_type] ?? article.article_type} ${article.title ?? ""}`.trim();
            return (
              <article
                key={article.id}
                className="rounded-xl p-3"
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                }}
              >
                <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                  {label}
                </p>
                {article.title && article.article_type !== "article" && (
                  <p className="text-xs mb-1" style={{ color: "var(--text-primary)" }}>{article.title}</p>
                )}
                <p className="text-xs whitespace-pre-wrap leading-6" style={{ color: "var(--text-secondary)" }}>
                  {article.content || "（此條當時無文字內容）"}
                </p>
              </article>
            );
          }) : (
            <pre
              className="text-xs whitespace-pre-wrap font-mono rounded-xl p-4"
              style={{ color: "var(--text-secondary)", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            >
              {rev.content_snapshot}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
