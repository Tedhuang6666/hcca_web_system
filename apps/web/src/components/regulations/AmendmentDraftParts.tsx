"use client";

import { useState } from "react";

import LawTreeEditor, { inferParentIdByPrevious } from "@/components/regulations/LawTreeEditor";
import type { ArticleType, RegulationArticleOut } from "@/lib/types";
import {
  ARTICLE_TYPE_LABEL,
  fallbackTreeContent,
  getSubtreeInsertIndex,
  getTreeChangeSummary,
  type Draft,
  type DraftArticleContent,
  type DraftTreeArticle,
} from "./amendmentDraftUtils";

// Re-export everything so existing import paths continue to work
export type {
  DraftStatus,
  AmendmentType,
  DraftArticle,
  DraftArticleContent,
  Draft,
  DraftTreeArticle,
} from "./amendmentDraftUtils";
export {
  ARTICLE_TYPE_LABEL,
  storageKey,
  loadDrafts,
  saveDrafts,
  newId,
  articleToContent,
  articleToTreeArticle,
  fallbackTreeContent,
  getSubtreeInsertIndex,
  getTreeChangeSummary,
  buildDraftComparisonRows,
} from "./amendmentDraftUtils";
export { StepSubmit } from "./StepSubmit";

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

// ── 步驟 2：樹狀編輯 ──────────────────────────────────────────────────────────

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
      lineage_id: item.lineage_id ?? item.id,
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
          ...(items.find(source => source.id === item.id) ?? {}),
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

// ── 步驟 1：草案列表 ──────────────────────────────────────────────────────────

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
