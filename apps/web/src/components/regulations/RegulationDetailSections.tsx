"use client";

import { useCallback, useMemo, useState } from "react";
import { diffLines } from "diff";

import type {
  ArticleType,
  RegulationArticleOut,
  RegulationRevisionOut,
  RegulationWorkflowLogOut,
  RegulationWorkflowStatus,
} from "@/lib/types";
import {
  ARTICLE_TYPE_LABEL as STRUCT_LABEL,
  ARTICLE_IS_STRUCTURAL as STRUCT_IS_STRUCTURAL,
  buildArticleDisplayRows as buildDisplayRowsFn,
} from "@/lib/regulationStructure";

import { LawArticleRow } from "./LawArticleRow";

export type Tab = "content" | "revisions" | "workflow";

export function isTab(value: string | null): value is Tab {
  return value === "content" || value === "revisions" || value === "workflow";
}

export const ARTICLE_TYPE_LABEL = STRUCT_LABEL as Record<ArticleType, string>;
export const ARTICLE_IS_STRUCTURAL = STRUCT_IS_STRUCTURAL as Record<ArticleType, boolean>;

type ProposalChangeCard = {
  status: string;
  text: string;
  note: string;
};

type ParsedProposalSnapshot = {
  title: string | null;
  rationale: string | null;
  changes: ProposalChangeCard[];
  extras: Array<{ label: string; content: string }>;
  raw: string;
};

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

function parseProposalSnapshot(raw: string): ParsedProposalSnapshot {
  const snapshot: ParsedProposalSnapshot = {
    title: null,
    rationale: null,
    changes: [],
    extras: [],
    raw,
  };
  const blocks = raw.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);

  for (const block of blocks) {
    if (block.startsWith("提案標題：")) {
      snapshot.title = block.replace(/^提案標題：/, "").trim() || null;
      continue;
    }
    if (block.startsWith("修正說明與理由：")) {
      snapshot.rationale = block.replace(/^修正說明與理由：/, "").trim() || null;
      continue;
    }
    if (block.startsWith("修正條文整理：")) {
      const body = block.replace(/^修正條文整理：/, "").trim();
      const changeBlocks = body.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
      for (const item of changeBlocks) {
        const [firstLine, ...restLines] = item.split("\n");
        const statusMatch = firstLine.match(/^([^：]+)：(.+)$/);
        const noteLine = restLines.find((line) => line.startsWith("說明：")) ?? "";
        snapshot.changes.push({
          status: statusMatch?.[1]?.trim() ?? "修正",
          text: statusMatch?.[2]?.trim() ?? firstLine.trim(),
          note: noteLine.replace(/^說明：/, "").trim(),
        });
      }
      continue;
    }
    const [label, ...contentParts] = block.split("：");
    snapshot.extras.push({
      label: contentParts.length > 0 ? label.trim() : "補充說明",
      content: contentParts.length > 0 ? contentParts.join("：").trim() : block,
    });
  }

  return snapshot;
}

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

function findSnapshotArticleTarget(
  change: ProposalChangeCard,
  articles: RevisionSnapshotArticle[],
): string | null {
  const legalNumberMatch = change.text.match(/第\s*([0-9]+(?:-[0-9]+)?)\s*條/);
  if (legalNumberMatch) {
    const matched = articles.find((article) => article.legal_number === legalNumberMatch[1]);
    if (matched) return matched.id;
  }

  const normalized = change.text.replace(/^[^：]+：/, "").trim();
  if (!normalized) return null;
  const needle = normalized.slice(0, 30);
  const matched = articles.find((article) => {
    const haystack = `${article.title ?? ""} ${article.content ?? ""}`.trim();
    return haystack.includes(needle);
  });
  return matched?.id ?? null;
}

export function filenameFromContentDisposition(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return fallback;
    }
  }
  return disposition.match(/filename="?([^"]+)"?/i)?.[1] ?? fallback;
}

export const PROSE = `prose prose-invert prose-sm max-w-none
  prose-headings: prose-headings:font-semibold
  prose-p: prose-p:leading-relaxed
  prose-strong: prose-a:text-sky-400
  prose-code: prose-code:bg-sky-900/30 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
  prose-blockquote:border-l-sky-500
  prose-li: prose-hr:border-slate-700
  prose-table: prose-th: prose-th:bg-slate-800/50
  prose-td:border-slate-700 prose-th:border-slate-700`;

// ── 版本差異 Modal（逐行高亮 diff）────────────────────────────────────────────

export function DiffModal({
  revA, revB, onClose,
}: {
  revA: RegulationRevisionOut;
  revB: RegulationRevisionOut | null;
  onClose: () => void;
}) {
  const oldText = revA.content_snapshot ?? "";
  const newText = revB?.content_snapshot ?? "";
  const oldLabel = `v${revA.version} · ${new Date(revA.amended_at).toLocaleDateString("zh-TW")} · ${revA.change_brief}`;
  const newLabel = revB
    ? `v${revB.version} · ${new Date(revB.amended_at).toLocaleDateString("zh-TW")} · ${revB.change_brief}`
    : "目前版本（無快照）";

  const diffResult = useMemo(() => {
    const changes = diffLines(oldText, newText, { ignoreWhitespace: false });
    const rows: Array<{ type: "add" | "remove" | "equal"; text: string }> = [];
    for (const change of changes) {
      const lines = change.value.split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      for (const line of lines) {
        rows.push({
          type: change.added ? "add" : change.removed ? "remove" : "equal",
          text: line,
        });
      }
    }
    return rows;
  }, [oldText, newText]);

  const addCount = diffResult.filter(r => r.type === "add").length;
  const removeCount = diffResult.filter(r => r.type === "remove").length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "var(--bg-overlay)" }}
      role="dialog" aria-modal="true">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative rounded-2xl overflow-hidden flex flex-col"
        style={{
          width: "min(1100px, 96vw)", maxHeight: "90vh",
          background: "var(--bg-surface)", border: "1px solid var(--border)",
          boxShadow: "var(--shadow-xl)",
        }}>
        {/* 標頭 */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-sm font-semibold flex-shrink-0" style={{ color: "var(--text-primary)" }}>版本比對</span>
            <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}>
              舊 {oldLabel}
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>→</span>
            <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: "rgba(34,197,94,0.12)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.25)" }}>
              新 {newLabel}
            </span>
          </div>
          <button onClick={onClose} className="topbar-icon-btn flex-shrink-0 ml-3" aria-label="關閉">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Diff 內容 */}
        <div className="flex-1 overflow-auto" style={{ fontFamily: "monospace", fontSize: "12px", lineHeight: "1.65" }}>
          {diffResult.length === 0
            ? <p className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>兩個版本內容完全相同</p>
            : diffResult.map((row, i) => {
                const isAdd = row.type === "add";
                const isRemove = row.type === "remove";
                return (
                  <div key={i}
                    className="flex items-start px-3 py-px"
                    style={{
                      background: isAdd ? "rgba(34,197,94,0.10)" : isRemove ? "rgba(239,68,68,0.10)" : "transparent",
                    }}>
                    <span className="w-5 flex-shrink-0 select-none text-center font-bold"
                      style={{ color: isAdd ? "#4ade80" : isRemove ? "#f87171" : "var(--text-disabled)" }}>
                      {isAdd ? "+" : isRemove ? "−" : " "}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap break-all pl-1"
                      style={{
                        color: isAdd ? "#86efac" : isRemove ? "#fca5a5" : "var(--text-secondary)",
                        textDecoration: isRemove ? "line-through" : "none",
                        opacity: row.type === "equal" ? 0.8 : 1,
                      }}>
                      {row.text || " "}
                    </span>
                  </div>
                );
              })}
        </div>

        {/* 統計列 */}
        <div className="flex items-center gap-4 px-5 py-2 flex-shrink-0 text-xs"
          style={{ borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
          <span style={{ color: "#4ade80" }}>＋ {addCount} 行新增</span>
          <span style={{ color: "#f87171" }}>－ {removeCount} 行刪除</span>
          <span style={{ color: "var(--text-muted)" }}>
            {diffResult.filter(r => r.type === "equal").length} 行不變
          </span>
        </div>
      </div>
    </div>
  );
}

// ── 審議流程 constants ─────────────────────────────────────────────────────────

const WF_META: Record<RegulationWorkflowStatus, { label: string; color: string; bg: string; step: number }> = {
  draft:            { label: "草稿",     color: "var(--text-muted)",   bg: "var(--bg-elevated)",           step: 0 },
  under_review:     { label: "送審中",   color: "#0284c7",             bg: "rgba(2,132,199,0.12)",         step: 1 },
  scheduled:        { label: "排入議程", color: "#7c3aed",             bg: "rgba(124,58,237,0.12)",        step: 2 },
  council_approved: { label: "議會核定", color: "var(--warning)",      bg: "var(--warning-dim)",           step: 3 },
  published:        { label: "已公布",   color: "var(--success)",      bg: "var(--success-dim)",           step: 4 },
  rejected:         { label: "已退回",   color: "var(--danger)",       bg: "rgba(220,38,38,0.1)",          step: -1 },
  archived:         { label: "已廢止",   color: "var(--text-disabled)","bg": "var(--bg-elevated)",         step: 5 },
};

const WF_STEPS: { key: RegulationWorkflowStatus; label: string }[] = [
  { key: "draft",            label: "起草" },
  { key: "under_review",     label: "送審" },
  { key: "scheduled",        label: "排入議程" },
  { key: "council_approved", label: "議會核定" },
  { key: "published",        label: "主席公布" },
];

export function WorkflowStatusBadge({ status }: { status: RegulationWorkflowStatus }) {
  const m = WF_META[status] ?? WF_META.draft;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ color: m.color, background: m.bg, border: `1px solid ${m.color}30` }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

// ── 審議流程時間軸 ─────────────────────────────────────────────────────────────

export function WorkflowTimeline({
  logs, currentStatus,
}: {
  logs: RegulationWorkflowLogOut[];
  currentStatus: RegulationWorkflowStatus;
}) {
  const currentMeta = WF_META[currentStatus];
  const currentStep = currentMeta?.step ?? 0;
  return (
    <div className="space-y-4">
      {/* 進度條 */}
      {currentStatus !== "rejected" && currentStatus !== "archived" && (
        <div className="card p-4">
          <p className="text-xs font-semibold mb-3" style={{ color: "var(--text-muted)" }}>審議進度</p>
          <div className="relative flex items-center">
            {WF_STEPS.map((s, i) => {
              const m = WF_META[s.key];
              const done = m.step <= currentStep;
              const active = s.key === currentStatus;
              return (
                <div key={s.key} className="flex-1 flex flex-col items-center relative">
                  {i < WF_STEPS.length - 1 && (
                    <div className="absolute top-3 left-1/2 w-full h-0.5"
                      style={{ background: done && !active ? m.color : "var(--border)" }} />
                  )}
                  <div className="w-6 h-6 rounded-full border-2 flex items-center justify-center z-10 text-[10px] font-bold"
                    style={{
                      background: done ? m.color : "var(--bg-surface)",
                      borderColor: done ? m.color : "var(--border)",
                      color: done ? "white" : "var(--text-muted)",
                    }}>
                    {done && !active ? "✓" : i + 1}
                  </div>
                  <span className="text-[10px] mt-1 text-center leading-tight"
                    style={{ color: active ? m.color : done ? "var(--text-secondary)" : "var(--text-muted)" }}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 日誌 */}
      {logs.length === 0 ? (
        <div className="card p-4 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          尚無流程記錄
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
            <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>流程記錄</p>
          </div>
          <ul>
            {[...logs].reverse().map((log, i) => {
              const fromM = WF_META[log.from_status as RegulationWorkflowStatus] ?? WF_META.draft;
              const toM = WF_META[log.to_status as RegulationWorkflowStatus] ?? WF_META.draft;
              return (
                <li key={log.id} className="px-4 py-3 flex items-start gap-3"
                  style={i < logs.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                  <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: toM.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium" style={{ color: toM.color }}>{toM.label}</span>
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>← {fromM.label}</span>
                    </div>
                    {log.note && (
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{log.note}</p>
                    )}
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {new Date(log.created_at).toLocaleString("zh-TW")}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

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
  const [showProposal, setShowProposal] = useState(false);
  const [highlightedSnapshotId, setHighlightedSnapshotId] = useState<string | null>(null);
  const isLatest = !currentRev || rev.id === currentRev.id;
  const proposalNote = rev.proposal_metadata_snapshot?.trim() || "";
  const parsedProposal = useMemo(() => parseProposalSnapshot(proposalNote), [proposalNote]);
  const snapshotArticles = useMemo(
    () => parseRevisionArticleSnapshot(rev.article_snapshot),
    [rev.article_snapshot],
  );

  const jumpToSnapshotArticle = useCallback((change: ProposalChangeCard) => {
    const targetId = findSnapshotArticleTarget(change, snapshotArticles);
    setExpanded(true);
    setShowProposal(false);
    setHighlightedSnapshotId(targetId);
    if (!targetId) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(`revision-snapshot-${rev.id}-${targetId}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    });
  }, [rev.id, snapshotArticles]);

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
          style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
          v{rev.version}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{rev.change_brief}</span>
            {rev.is_total_amendment && (
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ color: "#f59e0b", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)" }}>
                全文修訂
              </span>
            )}
            {isLatest && (
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ color: "var(--success)", background: "var(--success-dim)", border: "1px solid rgba(34,197,94,0.25)" }}>
                最新版本
              </span>
            )}
          </div>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {new Date(rev.amended_at).toLocaleDateString("zh-TW")} · {rev.amended_by_name ?? rev.amended_by}
          </p>
          <div className="mt-2 space-y-1 text-xs">
            <p style={{ color: "var(--text-muted)" }}>修正摘要</p>
            <p style={{ color: "var(--text-secondary)" }}>{rev.change_brief || "未留存"}</p>
            <p style={{ color: "var(--text-muted)" }}>提案內容</p>
            {proposalNote ? (
              <button
                onClick={() => setShowProposal(true)}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg hover:opacity-80"
                style={{ color: "var(--primary)", border: "1px solid var(--border-strong)", background: "var(--primary-dim)" }}
              >
                查看當時提案內容
              </button>
            ) : (
              <p className="whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
                此版本未留存提案說明
              </p>
            )}
          </div>
          {rev.resolution_link && (
            <a href={rev.resolution_link} target="_blank" rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-opacity hover:opacity-80"
              style={{ color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}>
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
              className="text-xs px-2.5 py-1 rounded-lg transition-all hover:opacity-80"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
              ↔ 與前版比較
            </button>
          )}
          {rev.content_snapshot && currentRev && !isLatest && (
            <button onClick={() => onDiff(rev, currentRev)}
              className="text-xs px-2.5 py-1 rounded-lg transition-all hover:opacity-80"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
              ↔ 與最新版比較
            </button>
          )}
          {rev.content_snapshot && (
            <button onClick={() => setExpanded(p => !p)}
              className="text-xs px-2.5 py-1 rounded-lg transition-all hover:opacity-80"
              style={{ color: "var(--primary)", border: "1px solid var(--border-strong)", background: "var(--primary-dim)" }}>
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
            const isHighlighted = highlightedSnapshotId === article.id;
            return (
              <article
                key={article.id}
                id={`revision-snapshot-${rev.id}-${article.id}`}
                className="rounded-xl p-3 transition-colors"
                style={{
                  border: `1px solid ${isHighlighted ? "var(--border-strong)" : "var(--border)"}`,
                  background: isHighlighted ? "var(--primary-dim)" : "var(--bg-elevated)",
                }}
              >
                <p className="text-xs font-semibold mb-1" style={{ color: isHighlighted ? "var(--primary)" : "var(--text-primary)" }}>
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
      {showProposal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
          style={{ background: "var(--bg-overlay)" }}
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0" onClick={() => setShowProposal(false)} aria-hidden="true" />
          <div
            className="relative rounded-2xl overflow-hidden flex flex-col"
            style={{
              width: "min(880px, 96vw)",
              maxHeight: "88vh",
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-xl)",
            }}
          >
            <div className="flex items-center justify-between px-5 py-3"
              style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  v{rev.version} 提案內容
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {new Date(rev.amended_at).toLocaleDateString("zh-TW")} · {rev.amended_by_name ?? rev.amended_by}
                </p>
              </div>
              <button onClick={() => setShowProposal(false)} className="topbar-icon-btn" aria-label="關閉">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-5 overflow-auto">
              <div className="space-y-4">
                {parsedProposal.title && (
                  <section className="rounded-xl p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                    <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>提案標題</p>
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{parsedProposal.title}</p>
                  </section>
                )}

                {parsedProposal.rationale && (
                  <section className="rounded-xl p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                    <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>修正說明與理由</p>
                    <p className="whitespace-pre-wrap text-sm leading-7" style={{ color: "var(--text-secondary)" }}>
                      {parsedProposal.rationale}
                    </p>
                  </section>
                )}

                {parsedProposal.changes.length > 0 && (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>逐條修正理由</p>
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        共 {parsedProposal.changes.length} 筆
                      </span>
                    </div>
                    <div className="space-y-3">
                      {parsedProposal.changes.map((change, index) => (
                        <article
                          key={`${change.status}-${change.text}-${index}`}
                          className="rounded-xl p-4"
                          style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
                        >
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <span
                              className="text-[11px] px-2 py-0.5 rounded-full"
                              style={{
                                color: change.status === "新增"
                                  ? "var(--success)"
                                  : change.status === "刪除"
                                    ? "var(--danger)"
                                    : "var(--primary)",
                                background: change.status === "新增"
                                  ? "var(--success-dim)"
                                  : change.status === "刪除"
                                    ? "rgba(220,38,38,0.1)"
                                    : "var(--primary-dim)",
                                border: "1px solid var(--border-strong)",
                              }}
                            >
                              {change.status}
                            </span>
                            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                              {change.text}
                            </p>
                          </div>
                          <p className="text-xs whitespace-pre-wrap leading-6" style={{ color: "var(--text-secondary)" }}>
                            {change.note || "未另填個別修正理由"}
                          </p>
                          <button
                            type="button"
                            onClick={() => jumpToSnapshotArticle(change)}
                            className="mt-3 inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg hover:opacity-80"
                            style={{ color: "var(--primary)", border: "1px solid var(--border-strong)", background: "var(--primary-dim)" }}
                          >
                            跳到當時條文
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                )}

                {parsedProposal.extras.length > 0 && (
                  <section className="grid gap-3">
                    {parsedProposal.extras.map((extra, index) => (
                      <article
                        key={`${extra.label}-${index}`}
                        className="rounded-xl p-4"
                        style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
                      >
                        <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>{extra.label}</p>
                        <p className="whitespace-pre-wrap text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
                          {extra.content}
                        </p>
                      </article>
                    ))}
                  </section>
                )}

                {!parsedProposal.title && !parsedProposal.rationale && parsedProposal.changes.length === 0 && parsedProposal.extras.length === 0 && (
                  <pre
                    className="whitespace-pre-wrap text-xs leading-6 rounded-xl p-4"
                    style={{
                      color: "var(--text-secondary)",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      border: "1px solid var(--border)",
                      background: "var(--bg-elevated)",
                    }}
                  >
                    {parsedProposal.raw}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 流程備註輸入 Modal ─────────────────────────────────────────────────────────

export function WfNoteModal({
  label, hint, placeholder, onClose, onSubmit,
}: {
  label: string; hint?: string; placeholder?: string;
  onClose: () => void; onSubmit: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isPresidentPublish = label.includes("主席公布");
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "var(--bg-overlay)" }} role="dialog" aria-modal="true">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative rounded-2xl overflow-hidden"
        style={{ width: "min(480px,96vw)", background: "var(--bg-surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-xl)" }}>
        <div className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{label}</span>
          <button onClick={onClose} className="topbar-icon-btn" aria-label="關閉">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-3">
          {isPresidentPublish && (
            <div className="px-3 py-2 rounded-lg text-xs"
              style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.25)", color: "#d97706" }}>
              公布後將自動生成套用「主令」字號的公文，並附上修正條文對照表。
            </div>
          )}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--text-secondary)" }}>
              {hint ?? "備註 / 原因（選填）"}
            </label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-none"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              placeholder={placeholder ?? "請說明備註或原因..."} />
          </div>
        </div>
        <div className="flex justify-end gap-3 px-5 pb-4">
          <button onClick={onClose} className="btn btn-ghost text-xs px-4 py-1.5">取消</button>
          <button
            disabled={submitting}
            onClick={async () => { setSubmitting(true); await onSubmit(note); }}
            className="btn btn-primary text-xs px-4 py-1.5">
            {submitting ? "處理中…" : "確認"}
          </button>
        </div>
      </div>
    </div>
  );
}
