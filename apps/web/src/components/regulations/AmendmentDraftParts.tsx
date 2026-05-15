"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import LawTreeEditor, { inferParentIdByPrevious } from "@/components/regulations/LawTreeEditor";
import { ApiError, regulationsApi } from "@/lib/api";
import type { ArticleType, RegulationArticleOut, RegulationOut } from "@/lib/types";

// ── 型別定義 ──────────────────────────────────────────────────────────────────

export type DraftStatus = "unchanged" | "modified" | "deleted" | "added";
export type AmendmentType = "partial" | "full";

export interface DraftArticle {
  id: string;
  status: DraftStatus;
  current: DraftArticleContent;
  originalContent: DraftArticleContent | null;
  comment: string;
}

export interface DraftArticleContent {
  article_type: ArticleType;
  title: string | null;
  content: string | null;
  order_index: number;
}

export interface Draft {
  id: string;
  name: string;
  amendmentType: AmendmentType;
  updatedAt: string;
  partialContent: DraftArticle[];
  fullContent: DraftArticleContent[];
  treeContent: DraftTreeArticle[];
  originalTreeContent: DraftTreeArticle[];
}

export interface DraftTreeArticle {
  id: string;
  parent_id: string | null;
  sort_index: number;
  order_index: number;
  article_type: ArticleType;
  title: string;
  content: string;
  legal_number?: string | null;
  comment?: string;
}

export const ARTICLE_TYPE_LABEL: Record<string, string> = {
  volume: "編", chapter: "章", section: "節",
  article: "條", clause: "條", paragraph: "項",
  subparagraph: "款", subsection: "款", item: "目",
  special_clause: "附則",
};

// ── localStorage 工具 ─────────────────────────────────────────────────────────

export function storageKey(regId: string) { return `amendment_drafts_${regId}`; }

export function loadDrafts(regId: string): Draft[] {
  try {
    const raw = localStorage.getItem(storageKey(regId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveDrafts(regId: string, drafts: Draft[]) {
  try { localStorage.setItem(storageKey(regId), JSON.stringify(drafts)); } catch { /* ignore */ }
}

export function newId() { return `d${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

export function articleToContent(a: RegulationArticleOut): DraftArticleContent {
  return { article_type: a.article_type, title: a.title, content: a.content, order_index: a.order_index };
}

export function articleToTreeArticle(a: RegulationArticleOut): DraftTreeArticle {
  return {
    id: a.id,
    parent_id: a.parent_id ?? null,
    sort_index: a.sort_index,
    order_index: a.order_index ?? 0,
    article_type: a.article_type,
    title: a.title ?? "",
    content: a.content ?? "",
    legal_number: a.legal_number ?? null,
  };
}

export function fallbackTreeContent(draft: Draft): DraftTreeArticle[] {
  if (draft.treeContent?.length) return draft.treeContent;
  const source = draft.fullContent.length ? draft.fullContent : draft.partialContent.map(item => item.current);
  return source.map((item, index) => ({
    id: newId(),
    parent_id: null,
    sort_index: index + 1,
    order_index: index,
    article_type: item.article_type,
    title: item.title ?? "",
    content: item.content ?? "",
    legal_number: null,
    comment: "",
  }));
}

export function getSubtreeInsertIndex(items: DraftTreeArticle[], anchorId: string) {
  const sorted = items.slice().sort((a, b) => a.sort_index - b.sort_index);
  const start = sorted.findIndex(item => item.id === anchorId);
  if (start < 0) return sorted.length;
  const subtreeIds = new Set<string>([anchorId]);
  let end = start;
  for (let i = start + 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current.parent_id && subtreeIds.has(current.parent_id)) {
      subtreeIds.add(current.id);
      end = i;
      continue;
    }
    break;
  }
  return end + 1;
}

export function getTreeChangeSummary(draft: Draft) {
  const current = fallbackTreeContent(draft);
  const baseline = draft.originalTreeContent?.length ? draft.originalTreeContent : [];
  const original = new Map(
    baseline.map(item => [
      item.id,
      {
        article_type: item.article_type,
        title: item.title,
        content: item.content,
        parent_id: item.parent_id,
        order_index: item.order_index,
      },
    ]),
  );
  const currentIds = new Set(current.map(item => item.id));
  const rows: Array<{ id: string; status: "新增" | "修改" | "刪除"; type: ArticleType; title: string }> = [];

  for (const item of current) {
    const base = original.get(item.id);
    if (!base) {
      rows.push({ id: item.id, status: "新增", type: item.article_type, title: item.title || "（未命名）" });
      continue;
    }
    if (
      base.article_type !== item.article_type ||
      base.title !== item.title ||
      base.content !== item.content ||
      base.parent_id !== item.parent_id ||
      base.order_index !== item.order_index
    ) {
      rows.push({ id: item.id, status: "修改", type: item.article_type, title: item.title || "（未命名）" });
    }
  }

  for (const item of baseline) {
    if (!currentIds.has(item.id)) {
      rows.push({
        id: `${item.id}-deleted`,
        status: "刪除",
        type: item.article_type,
        title: item.title || "（未命名）",
      });
    }
  }

  return rows;
}

export function buildDraftComparisonRows(draft: Draft) {
  const current = fallbackTreeContent(draft)
    .filter(item => item.article_type === "article" || item.article_type === "clause")
    .sort((a, b) => a.sort_index - b.sort_index);
  const baseline = (draft.originalTreeContent ?? [])
    .filter(item => item.article_type === "article" || item.article_type === "clause")
    .sort((a, b) => a.sort_index - b.sort_index);

  const originalById = new Map(baseline.map(item => [item.id, item]));
  const currentById = new Map(current.map(item => [item.id, item]));
  const rows: Array<{
    id: string;
    status: "新增" | "修改" | "刪除";
    revised_text: string;
    current_text: string;
    note: string;
  }> = [];

  for (const item of current) {
    const original = originalById.get(item.id);
    const revisedText = [item.title, item.content].filter(Boolean).join("　").trim();
    if (!original) {
      rows.push({
        id: item.id,
        status: "新增",
        revised_text: revisedText || "—",
        current_text: "—",
        note: item.comment?.trim() || "",
      });
      continue;
    }
    const originalText = [original.title, original.content].filter(Boolean).join("　").trim();
    if (
      original.title !== item.title
      || original.content !== item.content
      || original.parent_id !== item.parent_id
      || original.sort_index !== item.sort_index
    ) {
      rows.push({
        id: item.id,
        status: "修改",
        revised_text: revisedText || "—",
        current_text: originalText || "—",
        note: item.comment?.trim() || "",
      });
    }
  }

  for (const item of baseline) {
    if (!currentById.has(item.id)) {
      rows.push({
        id: `deleted-${item.id}`,
        status: "刪除",
        revised_text: "—",
        current_text: [item.title, item.content].filter(Boolean).join("　").trim() || "—",
        note: item.comment?.trim() || "",
      });
    }
  }

  return rows;
}

// ── 條文編輯器 Modal ──────────────────────────────────────────────────────────

export function ArticleEditorModal({
  initial, onSave, onClose, isNew,
}: {
  initial: DraftArticleContent;
  onSave: (c: DraftArticleContent) => void;
  onClose: () => void;
  isNew: boolean;
}) {
  const [form, setForm] = useState<DraftArticleContent>({ ...initial });

  const TYPES: { value: ArticleType; label: string }[] = [
    { value: "volume", label: "編" }, { value: "chapter", label: "章" }, { value: "section", label: "節" },
    { value: "article", label: "條" }, { value: "paragraph", label: "項" },
    { value: "subparagraph", label: "款" }, { value: "item", label: "目" },
    { value: "special_clause", label: "附則" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "var(--bg-overlay)" }} role="dialog" aria-modal="true">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative rounded-2xl overflow-hidden flex flex-col"
        style={{ width: "min(640px, 96vw)", maxHeight: "90vh", background: "var(--bg-surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-xl)" }}>
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {isNew ? "新增條文" : "修改條文"}
          </span>
          <button onClick={onClose} className="topbar-icon-btn" aria-label="關閉">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>類型</label>
            <select value={form.article_type}
              onChange={e => setForm(f => ({ ...f, article_type: e.target.value as ArticleType }))}
              className="w-full text-sm px-3 py-2 rounded-lg outline-none"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}（{t.value}）</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>標題</label>
            <input value={form.title ?? ""}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full text-sm px-3 py-2 rounded-lg outline-none"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              placeholder="例：第一條、第一章 總則…" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>內容</label>
            <textarea value={form.content ?? ""} rows={6}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-none"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              placeholder="條文正文…" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-3.5 flex-shrink-0"
          style={{ borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ color: "var(--text-muted)" }}>取消</button>
          <button onClick={() => onSave(form)}
            className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
            style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
            確認
          </button>
        </div>
      </div>
    </div>
  );
}

export function StepEditTree({
  draft,
  onUpdate,
}: {
  draft: Draft;
  onUpdate: (items: DraftTreeArticle[]) => void;
}) {
  const items = fallbackTreeContent(draft);
  const [editingId, setEditingId] = useState<string | null>(null);

  const toArticle = (item: DraftTreeArticle): RegulationArticleOut => {
    const now = new Date().toISOString();
    return {
      id: item.id,
      regulation_id: "draft-amendment",
      sort_index: item.sort_index,
      order_index: item.order_index,
      parent_id: item.parent_id,
      article_type: item.article_type,
      title: item.title,
      subtitle: "",
      legal_number: item.legal_number ?? null,
      content: item.content,
      is_deleted: false,
      frozen_by: null,
      created_at: now,
      updated_at: now,
    };
  };

  const articles = items
    .slice()
    .sort((a, b) => a.sort_index - b.sort_index)
    .map(toArticle);

  const active = items.find(item => item.id === editingId) ?? null;
  const changes = getTreeChangeSummary(draft);

  const addNode = (type: ArticleType, afterId?: string) => {
    const sorted = items.slice().sort((a, b) => a.sort_index - b.sort_index);
    const insertIndex = afterId ? getSubtreeInsertIndex(sorted, afterId) : sorted.length;
    const parentId = inferParentIdByPrevious(
      sorted.map(item => ({
        id: item.id,
        parent_id: item.parent_id,
        order_index: item.order_index,
        sort_index: item.sort_index,
        article_type: item.article_type,
        title: item.title,
        subtitle: "",
        content: item.content,
        legal_number: item.legal_number ?? null,
      })),
      insertIndex,
      type,
    );
    const next = sorted.slice();
    next.splice(insertIndex, 0, {
      id: crypto.randomUUID(),
      parent_id: parentId,
      sort_index: insertIndex + 1,
      order_index: 0,
        article_type: type,
        title: "",
        content: "",
        legal_number: null,
        comment: "",
      });
    onUpdate(next.map((item, index) => ({ ...item, sort_index: index + 1 })));
  };

  const statusById = Object.fromEntries(
    getTreeChangeSummary(draft).map(change => [
      change.id.replace("-deleted", ""),
      {
        label: change.status,
        tone:
          change.status === "新增"
            ? "success"
            : change.status === "刪除"
              ? "danger"
              : "warning",
      } as const,
    ]),
  );

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        使用與新增法規相同的階層編輯器。拖曳會整塊移動子樹，折疊不影響資料。
      </p>
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => addNode("chapter", editingId ?? undefined)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>+ 章</button>
        <button onClick={() => addNode("section", editingId ?? undefined)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>+ 節</button>
        <button onClick={() => addNode("article", editingId ?? undefined)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>+ 條</button>
        <button onClick={() => addNode("paragraph", editingId ?? undefined)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>+ 項</button>
        <button onClick={() => addNode("subparagraph", editingId ?? undefined)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>+ 款</button>
        <button onClick={() => addNode("item", editingId ?? undefined)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>+ 目</button>
      </div>
      <LawTreeEditor
        articles={articles}
        statusById={statusById}
        onSelect={setEditingId}
        onChangeFlat={next => onUpdate(next.map((item, index) => ({
          id: item.id,
          parent_id: item.parent_id,
          sort_index: index + 1,
          order_index: item.order_index,
          article_type: item.article_type,
          title: item.title,
          content: item.content,
          legal_number: item.legal_number ?? null,
          comment: items.find(source => source.id === item.id)?.comment ?? "",
        })))}
        onEdit={id => setEditingId(id)}
        onDelete={id => {
          const ids = new Set<string>([id]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const item of items) {
              if (item.parent_id && ids.has(item.parent_id) && !ids.has(item.id)) {
                ids.add(item.id);
                changed = true;
              }
            }
          }
          onUpdate(items.filter(item => !ids.has(item.id)).map((item, index) => ({ ...item, sort_index: index + 1 })));
        }}
        onEnterSibling={id => {
          const current = items.find(item => item.id === id);
          if (!current) return;
          const insertIndex = getSubtreeInsertIndex(items, id);
          const parentId = inferParentIdByPrevious(
            items.map(item => ({
              id: item.id,
              parent_id: item.parent_id,
              order_index: item.order_index,
              sort_index: item.sort_index,
              article_type: item.article_type,
              title: item.title,
              subtitle: "",
              content: item.content,
              legal_number: item.legal_number ?? null,
            })),
            insertIndex,
            current.article_type,
          );
          const next = items.slice();
          next.splice(insertIndex, 0, {
            id: crypto.randomUUID(),
            parent_id: parentId,
            sort_index: insertIndex + 1,
            order_index: 0,
            article_type: current.article_type,
            title: "",
            content: "",
            legal_number: null,
            comment: "",
          });
          onUpdate(next.map((item, index) => ({ ...item, sort_index: index + 1 })));
        }}
        onDemote={id => {
          const sorted = items.slice().sort((a, b) => a.sort_index - b.sort_index);
          const idx = sorted.findIndex(item => item.id === id);
          if (idx <= 0) return;
          const prev = sorted[idx - 1];
          onUpdate(sorted.map(item => item.id === id ? { ...item, parent_id: prev.id } : item));
        }}
      />

      {active && (
        <ArticleEditorModal
          initial={{
            article_type: active.article_type,
            title: active.title,
            content: active.content,
            order_index: active.order_index,
          }}
          isNew={false}
          onSave={content => {
            onUpdate(items.map(item => item.id === active.id ? {
              ...item,
              article_type: content.article_type,
              title: content.title ?? "",
              content: content.content ?? "",
            } : item));
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      )}

      <div className="card p-4 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>異動明細</h3>
        {changes.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>目前尚無異動</p>
        ) : (
          <div className="space-y-1">
            {changes.map(change => (
              <div key={change.id} className="flex items-center gap-2 text-xs">
                <span
                  className="px-1.5 py-0.5 rounded"
                  style={{
                    color: change.status === "新增" ? "var(--success)" : change.status === "刪除" ? "var(--danger)" : "var(--warning)",
                    background: change.status === "新增" ? "var(--success-dim)" : change.status === "刪除" ? "rgba(220,38,38,0.08)" : "rgba(245,158,11,0.1)",
                  }}
                >
                  {change.status}
                </span>
                <span style={{ color: "var(--text-secondary)" }}>
                  {ARTICLE_TYPE_LABEL[change.type] ?? change.type}　{change.title}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 步驟 1：草案列表 ───────────────────────────────────────────────────────────

export function StepDraftList({
  drafts, onOpen, onNew, onDelete, onImport,
}: {
  drafts: Draft[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onImport: (file: File) => void;
}) {
  const fileRef = { current: null as HTMLInputElement | null };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>已儲存的修正草案</h3>
        <div className="flex gap-2">
          <button onClick={() => fileRef.current?.click()}
            className="text-xs px-3 py-1.5 rounded-lg hover:opacity-80 inline-flex items-center gap-1.5"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
            </svg>
            匯入草案 (.json)
          </button>
          <input ref={el => { fileRef.current = el; }} type="file" accept=".json,.ckla" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) { onImport(f); e.target.value = ""; } }} />
          <button onClick={onNew}
            className="text-xs px-3 py-1.5 rounded-lg hover:opacity-90 inline-flex items-center gap-1.5 font-medium"
            style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            新增草案
          </button>
        </div>
      </div>

      {drafts.length === 0 ? (
        <div className="card p-12 text-center space-y-4">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" className="mx-auto opacity-30" style={{ color: "var(--text-muted)" }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>目前沒有已儲存的草案</p>
          <button onClick={onNew}
            className="text-sm px-4 py-2 rounded-lg hover:opacity-90 font-medium"
            style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
            立即建立草案
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden divide-y" style={{ borderColor: "var(--border)" }}>
          {drafts.map(d => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{d.name}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {d.amendmentType === "partial" ? "部分修正" : "全文修正"} ·
                  最後修改 {new Date(d.updatedAt).toLocaleString("zh-TW")}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => onDelete(d.id)}
                  className="p-1.5 rounded hover:opacity-80" style={{ color: "var(--danger)" }} title="刪除">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
                <button onClick={() => onOpen(d.id)}
                  className="text-xs px-3 py-1.5 rounded-lg hover:opacity-90 font-medium"
                  style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                  繼續編輯
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 步驟 3：提交 ──────────────────────────────────────────────────────────────

export function StepSubmit({
  draft, reg, onBack, onDone, onUpdateDraft,
}: {
  draft: Draft;
  reg: RegulationOut;
  onBack: () => void;
  onDone: (draftRegId: string) => void;
  onUpdateDraft: (updater: (prev: Draft) => Partial<Draft>) => void;
}) {
  const [brief, setBrief] = useState(`「${reg.title}」修正草案`);
  const [rationale, setRationale] = useState("");
  const [summaryOverride, setSummaryOverride] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [warnings, setWarnings] = useState<Array<{ source_article_id: string; source_title: string; referenced_legal_number: string; message: string }>>([]);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 16));
  const [timeMachine, setTimeMachine] = useState<{ version: number; amended_at: string; content_snapshot: string } | null>(null);
  const comparisonRows = buildDraftComparisonRows(draft);
  const autoSummary = comparisonRows
    .map(row => `${row.status}：${row.revised_text !== "—" ? row.revised_text : row.current_text}${row.note ? `\n說明：${row.note}` : ""}`)
    .join("\n\n");
  const changes = summaryOverride.trim() || autoSummary;

  useEffect(() => {
    regulationsApi.referenceWarnings(reg.id).then(setWarnings).catch(() => {});
  }, [reg.id]);

  const handleExport = () => {
    const payload = { draft, regulationId: reg.id, regulationTitle: reg.title, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reg.title}_${draft.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("草案已匯出");
  };

  const handleSubmit = async () => {
    if (!brief.trim()) { toast.error("請填寫提案標題"); return; }
    if (!rationale.trim()) { toast.error("請填寫修正說明"); return; }
    setSubmitting(true);
    try {
      const draftReg = await regulationsApi.forkDraft(reg.id);
      const latest = await regulationsApi.get(draftReg.id);
      await regulationsApi.update(draftReg.id, {
        amendment_type: "amend",
        amended_articles: comparisonRows.map(row => row.revised_text !== "—" ? row.revised_text : row.current_text).join("\n"),
        proposal_metadata: [
          `提案標題：${brief}`,
          `修正說明與理由：${rationale}`,
          changes ? `修正條文整理：\n${changes}` : "",
        ].filter(Boolean).join("\n\n"),
      });
      const roots = latest.articles.filter(article => !article.is_deleted && !article.parent_id);
      for (const root of roots) {
        await regulationsApi.deleteArticle(draftReg.id, root.id, false);
      }

      const sourceItems = fallbackTreeContent(draft).slice().sort((a, b) => a.sort_index - b.sort_index);
      const idMap = new Map<string, string>();
      for (let index = 0; index < sourceItems.length; index += 1) {
        const item = sourceItems[index];
        const created = await regulationsApi.addArticle(draftReg.id, {
          sort_index: index + 1,
          order_index: item.order_index,
          parent_id: item.parent_id ? (idMap.get(item.parent_id) ?? null) : null,
          article_type: item.article_type,
          title: item.title || undefined,
          subtitle: undefined,
          content: item.content || undefined,
          legal_number: item.legal_number ?? undefined,
        });
        idMap.set(item.id, created.id);
      }

      await regulationsApi.autoRenumber(draftReg.id, false);
      toast.success("已建立修正草案，請在草案頁面確認內容後送審");
      onDone(draftReg.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "建立草案失敗");
    } finally { setSubmitting(false); }
  };

  const changedCount = comparisonRows.length;

  return (
    <div className="space-y-5">
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>修正對照（三欄）</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: "var(--text-muted)" }}>
                <th className="text-left p-2">修正條文</th>
                <th className="text-left p-2">現行條文</th>
                <th className="text-left p-2">說明</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-3 text-center" style={{ color: "var(--text-muted)" }}>
                    目前尚未有實際條文異動
                  </td>
                </tr>
              ) : comparisonRows.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="p-2 whitespace-pre-wrap">
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-0.5 px-1.5 py-0.5 rounded text-[10px]"
                        style={{
                          color: row.status === "新增" ? "var(--success)" : row.status === "刪除" ? "var(--danger)" : "var(--warning)",
                          background: row.status === "新增" ? "var(--success-dim)" : row.status === "刪除" ? "rgba(220,38,38,0.1)" : "rgba(245,158,11,0.1)",
                        }}
                      >
                        {row.status}
                      </span>
                      <span>{row.revised_text || "—"}</span>
                    </div>
                  </td>
                  <td className="p-2 whitespace-pre-wrap">{row.current_text || "—"}</td>
                  <td className="p-2">
                    <textarea
                      value={row.note}
                      onChange={(e) => {
                        const nextNote = e.target.value;
                        const targetId = row.id.replace(/^deleted-/, "");
                        onUpdateDraft((prev) => ({
                          treeContent: fallbackTreeContent(prev).map((item) =>
                            item.id === targetId ? { ...item, comment: nextNote } : item,
                          ),
                        }));
                      }}
                      className="w-full text-xs px-2 py-1.5 rounded-lg outline-none resize-y min-h-20"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                      placeholder="請輸入本條修正說明"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>智能參照警示</h3>
        {warnings.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>目前無失效參照</p>
        ) : (
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={`${w.source_article_id}-${i}`} className="text-xs" style={{ color: "var(--danger)" }}>
                {w.source_title}：{w.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Time Machine</h3>
        <div className="flex gap-2 items-center">
          <input type="datetime-local" value={asOf} onChange={e => setAsOf(e.target.value)} className="text-xs px-2 py-1.5 rounded" style={{ border: "1px solid var(--border)" }} />
          <button
            onClick={async () => {
              try {
                const tm = await regulationsApi.timeMachine(reg.id, new Date(asOf).toISOString());
                setTimeMachine({ version: tm.version, amended_at: tm.amended_at, content_snapshot: tm.content_snapshot });
              } catch {
                toast.error("該時間點無快照");
              }
            }}
            className="text-xs px-3 py-1.5 rounded"
            style={{ border: "1px solid var(--border)" }}
          >
            回溯
          </button>
        </div>
        {timeMachine && (
          <div className="text-xs space-y-1">
            <p style={{ color: "var(--text-muted)" }}>版本：v{timeMachine.version}（{new Date(timeMachine.amended_at).toLocaleString("zh-TW")}）</p>
            <pre className="p-2 rounded whitespace-pre-wrap max-h-48 overflow-auto" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
              {timeMachine.content_snapshot}
            </pre>
          </div>
        )}
      </div>

      {/* 草案摘要 */}
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-muted)" }}>草案摘要</h3>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          {([
            ["草案名稱", draft.name],
            ["修正類型", draft.amendmentType === "partial" ? "部分修正" : "全文修正"],
            ["異動條文數", String(changedCount)],
            ["目標法規", reg.title],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k}>
              <dt style={{ color: "var(--text-muted)" }}>{k}</dt>
              <dd className="mt-0.5 font-medium" style={{ color: "var(--text-primary)" }}>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* 變更清單（partial） */}
      {draft.amendmentType === "partial" && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>異動明細</h3>
          <div className="space-y-1">
            {fallbackTreeContent(draft).map(i => (
              <div key={i.id} className="flex items-start gap-2 text-xs">
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px]"
                  style={{ color: "var(--primary)", background: "var(--primary-dim)" }}>
                  {ARTICLE_TYPE_LABEL[i.article_type] ?? i.article_type}
                </span>
                <span style={{ color: "var(--text-secondary)" }}>{i.title || "（未命名）"}</span>
              </div>
            ))}
            {fallbackTreeContent(draft).length === 0 && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>無任何修正</p>
            )}
          </div>
        </div>
      )}

      {/* 提案表單 */}
      <div className="card p-5 space-y-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>送審資訊</h3>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
            提案標題 <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input value={brief} onChange={e => setBrief(e.target.value)}
            className="w-full text-sm px-3 py-2 rounded-lg outline-none"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            placeholder="例：「XX 規則」第三條修正草案" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
            修正說明與理由 <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={4}
            className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-none"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            placeholder="說明為何需要修正…" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
            修正摘要（條文對照，選填）
          </label>
          <textarea value={summaryOverride || autoSummary} onChange={e => setSummaryOverride(e.target.value)} rows={4}
            className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-none font-mono"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            placeholder={`現行條文：第X條 ...\n修正條文：第X條 ...`} />
        </div>
      </div>

      {/* 操作按鈕 */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="btn btn-ghost text-sm px-4">← 返回編輯</button>
        <button onClick={handleExport}
          className="text-sm px-4 py-2 rounded-lg hover:opacity-80 inline-flex items-center gap-1.5"
          style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
          </svg>
          匯出草案 (.json)
        </button>
        <button onClick={handleSubmit} disabled={submitting || !brief.trim() || !rationale.trim()}
          className="btn btn-primary text-sm px-5 ml-auto disabled:opacity-40">
          {submitting ? "送審中…" : "直接送法規審核 →"}
        </button>
      </div>
    </div>
  );
}
