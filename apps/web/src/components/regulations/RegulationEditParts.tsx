"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import type {
  ArticleType,
  RegulationArticleOut,
  RegulationCategory,
  RegulationWorkflowStatus,
} from "@/lib/types";

// ── 靜態對照表 ─────────────────────────────────────────────────────────────────

export const CATEGORIES: [RegulationCategory, string][] = [
  ["constitution",       "憲章"],
  ["ordinance",          "條例"],
  ["procedure",          "辦法"],
];

export const ARTICLE_TYPES: [ArticleType, string][] = [
  ["volume",        "編"],
  ["chapter",       "章"],
  ["section",       "節"],
  ["article",       "條"],
  ["paragraph",     "項"],
  ["subparagraph",  "款"],
  ["item",          "目"],
  ["special_clause","附則"],
];

export type LawNode = {
  id: string;
  type: ArticleType;
  title: string;
  content: string;
  legalNumber: string;
  children: LawNode[];
  isCollapsed: boolean;
  article: RegulationArticleOut;
};



export const WF_LABELS: Record<RegulationWorkflowStatus, string> = {
  draft:            "草稿",
  under_review:     "送審中",
  scheduled:        "排入議程",
  council_approved: "議會核定",
  published:        "現行有效",
  rejected:         "已退回",
  archived:         "已廢止",
};

export const WF_COLORS: Record<RegulationWorkflowStatus, string> = {
  draft:            "var(--text-muted)",
  under_review:     "#0284c7",
  scheduled:        "#7c3aed",
  council_approved: "var(--warning)",
  published:        "var(--success)",
  rejected:         "var(--danger)",
  archived:         "var(--text-muted)",
};

export type NewArtForm = { article_type: ArticleType; title: string; content: string };
export const EMPTY_FORM: NewArtForm = { article_type: "article", title: "", content: "" };



// ── 簡易 Line Diff ─────────────────────────────────────────────────────────────

type DiffLine = { type: "same" | "add" | "remove"; text: string };

function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const result: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      result.push({ type: "same", text: a[i] }); i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: "add", text: b[j] }); j++;
    } else {
      result.push({ type: "remove", text: a[i] }); i++;
    }
  }
  return result;
}

// ── Diff 預覽彈窗 ─────────────────────────────────────────────────────────────

export function DiffModal({
  oldContent, newContent, version, onConfirm, onClose,
}: {
  oldContent: string; newContent: string; version: number;
  onConfirm: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const diff = lineDiff(oldContent, newContent);
  const addedCount = diff.filter(l => l.type === "add").length;
  const removedCount = diff.filter(l => l.type === "remove").length;
  const hasChanges = addedCount > 0 || removedCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl flex flex-col"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", maxHeight: "85vh" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-4 py-4 border-b flex-shrink-0 sm:px-5"
          style={{ borderColor: "var(--border)" }}>
          <div>
            <h3 className="text-sm font-semibold">全文差異比對</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              v{version} → v{version + 1}
              {hasChanges
                ? <> &nbsp;·&nbsp; <span style={{ color: "#4ade80" }}>+{addedCount} 行</span>
                  &nbsp;<span style={{ color: "#f87171" }}>−{removedCount} 行</span></>
                : <> &nbsp;·&nbsp; <span>全文內容無變更</span></>}
            </p>
          </div>
          <button onClick={onClose} className="cursor-pointer" style={{ color: "var(--text-muted)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto font-mono text-xs" style={{ lineHeight: "1.6" }}>
          {!hasChanges ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: "var(--text-muted)" }}>
              <span className="text-2xl">≡</span>
              <p>全文內容與上一版本相同</p>
              <p className="text-[11px]">條文結構或基本資訊的更動不在此比對範圍</p>
            </div>
          ) : diff.map((line, idx) => {
            if (line.type === "same") return (
              <div key={idx} className="flex px-4 py-0.5" style={{ color: "var(--text-muted)" }}>
                <span className="w-6 flex-shrink-0 select-none opacity-40 text-right mr-3">{idx + 1}</span>
                <span className="whitespace-pre-wrap break-all">{line.text || " "}</span>
              </div>
            );
            if (line.type === "add") return (
              <div key={idx} className="flex px-4 py-0.5"
                style={{ background: "rgba(34,197,94,0.08)", color: "#4ade80" }}>
                <span className="w-6 flex-shrink-0 select-none opacity-60 text-right mr-3">+</span>
                <span className="whitespace-pre-wrap break-all">{line.text || " "}</span>
              </div>
            );
            return (
              <div key={idx} className="flex px-4 py-0.5"
                style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", textDecoration: "line-through" }}>
                <span className="w-6 flex-shrink-0 select-none opacity-60 text-right mr-3">−</span>
                <span className="whitespace-pre-wrap break-all">{line.text || " "}</span>
              </div>
            );
          })}
        </div>

        <div
          className="flex flex-col gap-3 px-4 py-4 border-t flex-shrink-0 sm:flex-row sm:items-center sm:justify-between sm:px-5"
          style={{ borderColor: "var(--border)" }}>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            確認無誤後，點擊「繼續發布」填寫修訂摘要
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm cursor-pointer"
              style={{ color: "var(--text-muted)" }}>返回編輯</button>
            <button onClick={onConfirm} className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
              style={{ background: "rgba(34,211,238,0.15)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.3)" }}>
              繼續發布 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function buildLawTree(
  rows: RegulationArticleOut[],
  collapsed: Record<string, boolean>,
): LawNode[] {
  const map = new Map<string, LawNode>();
  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      type: row.article_type,
      title: row.title ?? "",
      content: row.content ?? "",
      legalNumber: row.legal_number ?? "",
      children: [],
      isCollapsed: collapsed[row.id] ?? false,
      article: row,
    });
  }
  const roots: LawNode[] = [];
  for (const row of rows) {
    const node = map.get(row.id)!;
    const parentId = row.parent_id ?? null;
    if (parentId && map.has(parentId)) map.get(parentId)!.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (nodes: LawNode[]) => {
    nodes.sort((a, b) => a.article.order_index - b.article.order_index || a.article.sort_index - b.article.sort_index);
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(roots);
  return roots;
}

export function flattenTree(nodes: LawNode[], parentId: string | null = null, acc: Array<{ id: string; parent_id: string | null; order_index: number; sort_index: number }> = []): typeof acc {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    acc.push({ id: n.id, parent_id: parentId, order_index: i, sort_index: acc.length + 1 });
    flattenTree(n.children, n.id, acc);
  }
  return acc;
}

// ── 發布彈窗 ───────────────────────────────────────────────────────────────────

export function PublishModal({
  version, onPublish, onClose,
}: {
  version: number;
  onPublish: (data: { change_brief: string; is_total_amendment: boolean; resolution_link: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [brief, setBrief] = useState("");
  const [isTotal, setIsTotal] = useState(false);
  const [link, setLink] = useState("");
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handlePublish = async () => {
    if (!brief.trim()) { toast.error("請填寫修訂摘要"); return; }
    setPublishing(true);
    try { await onPublish({ change_brief: brief, is_total_amendment: isTotal, resolution_link: link }); }
    finally { setPublishing(false); }
  };

  const inputStyle = { border: "1px solid var(--border)" };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-4"
      style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-xl p-4 space-y-4 max-h-[90vh] overflow-y-auto sm:p-5"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">發布法規 → v{version + 1}</h3>
          <button onClick={onClose} className="cursor-pointer hover:opacity-70">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>修訂摘要 *</label>
            <input value={brief} onChange={e => setBrief(e.target.value)}
              placeholder="例：修訂第三條選舉資格規定"
              className="w-full bg-transparent text-sm px-2 py-1.5 rounded outline-none" style={inputStyle} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isTotal} onChange={e => setIsTotal(e.target.checked)}
              className="w-3.5 h-3.5 rounded" />
            <span className="text-xs">全文修訂</span>
          </label>
          <div>
            <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>決議/議案連結（選填）</label>
            <input value={link} onChange={e => setLink(e.target.value)}
              placeholder="https://..."
              className="w-full bg-transparent text-sm px-2 py-1.5 rounded outline-none" style={inputStyle} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm cursor-pointer"
            style={{ color: "var(--text-muted)" }}>取消</button>
          <button onClick={handlePublish} disabled={publishing}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 cursor-pointer"
            style={{ background: "rgba(34,211,238,0.15)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.3)" }}>
            {publishing ? "發布中..." : "確認發布"}
          </button>
        </div>
      </div>
    </div>
  );
}
