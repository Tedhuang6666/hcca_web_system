"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import LawTreeEditor, { inferParentIdByPrevious } from "@/components/regulations/LawTreeEditor";
import { ApiError, orgsApi, regulationsApi, regulationHref, type OrgRead } from "@/lib/api";
import type { ArticleType, RegulationArticleOut, RegulationCategory } from "@/lib/types";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";

const CATEGORIES: [RegulationCategory, string][] = [
  ["constitution", "憲章"],
  ["ordinance", "條例"],
  ["procedure", "辦法"],
];

type DraftModal = {
  id: string;
  article_type: ArticleType;
  title: string;
  content: string;
};

type RegulationDraft = {
  selectedOrgId: string;
  title: string;
  category: RegulationCategory;
  preface: string;
  publishImported: boolean;
  articles: RegulationArticleOut[];
  activeId: string | null;
  modal: DraftModal | null;
};

function toArticle(id: string, type: ArticleType, parent_id: string | null, sort: number, order: number): RegulationArticleOut {
  const now = new Date().toISOString();
  return {
    id,
    regulation_id: "draft-local",
    lineage_id: id,
    sort_index: sort,
    order_index: order,
    parent_id,
    article_type: type,
    title: "",
    subtitle: "",
    legal_number: null,
    content: "",
    is_deleted: false,
    frozen_by: null,
    created_at: now,
    updated_at: now,
  };
}

export default function NewRegulationPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<RegulationCategory>("ordinance");
  const [preface, setPreface] = useState("");
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [publishImported, setPublishImported] = useState(false);
  const [articles, setArticles] = useState<RegulationArticleOut[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modal, setModal] = useState<DraftModal | null>(null);

  useEffect(() => {
    orgsApi.myRegulationCreateOrgs().then(list => {
      setOrgs(list);
      const stored = typeof window !== "undefined" ? localStorage.getItem("org_id") ?? "" : "";
      setSelectedOrgId(stored && list.some(o => o.id === stored) ? stored : list[0]?.id ?? "");
    }).catch(() => {});
  }, []);

  const draftValue = useMemo<RegulationDraft>(() => ({
    selectedOrgId,
    title,
    category,
    preface,
    publishImported,
    articles,
    activeId,
    modal,
  }), [activeId, articles, category, modal, preface, publishImported, selectedOrgId, title]);
  const restoreDraft = useCallback((draft: RegulationDraft) => {
    setSelectedOrgId(draft.selectedOrgId ?? "");
    setTitle(draft.title ?? "");
    setCategory(draft.category ?? "ordinance");
    setPreface(draft.preface ?? "");
    setPublishImported(Boolean(draft.publishImported));
    setArticles(draft.articles ?? []);
    setActiveId(draft.activeId ?? null);
    setModal(draft.modal ?? null);
    toast.info("已復原未建立的法規草案");
  }, []);
  const { clearDraft, flushDraft } = useDraftAutosave({
    key: "regulations:new",
    value: draftValue,
    onRestore: restoreDraft,
    isEmpty: useCallback((draft: RegulationDraft) => (
      !(draft.title ?? "").trim()
      && !(draft.preface ?? "").trim()
      && (draft.articles ?? []).length === 0
      && !draft.modal
    ), []),
  });

  const flat = useMemo(() => [...articles].sort((a, b) => a.sort_index - b.sort_index), [articles]);

  const addNode = (type: ArticleType, afterId?: string) => {
    const sorted = [...flat];
    const insertIndex = afterId ? Math.max(0, sorted.findIndex(x => x.id === afterId) + 1) : sorted.length;
    const parentId = inferParentIdByPrevious(
      sorted.map(s => ({
        id: s.id, parent_id: s.parent_id ?? null, order_index: s.order_index, sort_index: s.sort_index,
        article_type: s.article_type, title: s.title, subtitle: "", content: s.content ?? "", legal_number: s.legal_number ?? null,
      })),
      insertIndex,
      type,
    );
    const id = crypto.randomUUID();
    const next = [...sorted];
    next.splice(insertIndex, 0, toArticle(id, type, parentId, insertIndex + 1, 0));
    setArticles(next.map((a, i) => ({ ...a, sort_index: i + 1 })));
    setActiveId(id);
    setModal({ id, article_type: type, title: "", content: "" });
  };

  const saveDraft = async () => {
    if (!title.trim()) return toast.error("請輸入法規名稱");
    if (!selectedOrgId) return toast.error("請選擇所屬組織");
    setSaving(true);
    try {
      const reg = await regulationsApi.create({ title, category, content: "", preface: preface || undefined, org_id: selectedOrgId });
      const idMap = new Map<string, string>();
      for (const a of [...articles].sort((x, y) => x.sort_index - y.sort_index)) {
        const created = await regulationsApi.addArticle(reg.id, {
          sort_index: a.sort_index,
          order_index: a.order_index,
          parent_id: a.parent_id ? (idMap.get(a.parent_id) ?? null) : null,
          article_type: a.article_type,
          title: a.title || undefined,
          content: a.content || undefined,
          legal_number: a.legal_number ?? undefined,
        });
        idMap.set(a.id, created.id);
      }
      clearDraft();
      toast.success("法規草案已建立");
      router.push(`${regulationHref(reg)}/edit`);
    } catch (e) {
      flushDraft();
      toast.error(e instanceof ApiError ? e.message : "建立失敗");
    } finally {
      setSaving(false);
    }
  };

  const importDocxDrafts = async () => {
    if (!selectedOrgId) return toast.error("請選擇所屬組織");
    if (importFiles.length === 0) return toast.error("請選擇 Word 或 PDF 法規文檔");
    setImporting(true);
    try {
      const results = await regulationsApi.importDocuments(importFiles, {
        org_id: selectedOrgId,
        category,
        publish_immediately: publishImported,
      });
      const succeeded = results.filter(item => item.ok);
      const failed = results.filter(item => !item.ok);
      if (succeeded.length === 1 && failed.length === 0 && succeeded[0].regulation) {
        toast.success(`已匯入「${succeeded[0].regulation.title}」`);
        router.push(`${regulationHref(succeeded[0].regulation)}/edit`);
        return;
      }
      if (succeeded.length > 0) {
        toast.success(`已匯入 ${succeeded.length} 份法規${failed.length ? `，${failed.length} 份失敗` : ""}`);
        router.push("/regulations");
        return;
      }
      toast.error(failed[0]?.detail ?? "匯入失敗");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "匯入失敗");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/regulations" className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ border: "1px solid var(--border)" }}>←</Link>
        <div>
          <h1 className="text-xl font-semibold">新增法規草案</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>即時樹狀編輯、拖拽、快捷鍵與自動章節條號</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <section className="lg:col-span-3 space-y-4">
          <div className="card p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>所屬組織 *</label>
              <select
                value={selectedOrgId}
                onChange={e => setSelectedOrgId(e.target.value)}
                className="w-full text-sm px-2 py-1.5 rounded"
                style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
              >
                <option value="">選擇組織</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>分類</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as RegulationCategory)}
                className="w-full text-sm px-2 py-1.5 rounded"
                style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
              >
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>法規名稱 *</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full text-sm px-2 py-1.5 rounded"
                style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>前言 / 立法宗旨</label>
              <textarea
                value={preface}
                onChange={e => setPreface(e.target.value)}
                rows={2}
                className="w-full text-sm px-2 py-1.5 rounded"
                style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
              />
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => addNode("chapter", activeId ?? undefined)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>+ 章</button>
              <button onClick={() => addNode("section", activeId ?? undefined)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>+ 節</button>
              <button onClick={() => addNode("article", activeId ?? undefined)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>+ 條</button>
              <button onClick={() => addNode("paragraph", activeId ?? undefined)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>+ 項</button>
              <button onClick={() => addNode("subparagraph", activeId ?? undefined)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>+ 款</button>
              <button onClick={() => addNode("item", activeId ?? undefined)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>+ 目</button>
            </div>
            <LawTreeEditor
              articles={articles}
              onChangeFlat={next => {
                const map = new Map(articles.map(a => [a.id, a]));
                setArticles(next.map(n => ({
                  ...(map.get(n.id) ?? toArticle(n.id, n.article_type, n.parent_id, n.sort_index, n.order_index)),
                  parent_id: n.parent_id,
                  order_index: n.order_index,
                  sort_index: n.sort_index,
                  article_type: n.article_type,
                })));
              }}
              onEdit={id => {
                const a = articles.find(x => x.id === id);
                if (!a) return;
                setActiveId(id);
                setModal({
                  id,
                  article_type: a.article_type,
                  title: a.title ?? "",
                  content: a.content ?? "",
                });
              }}
              onDelete={id => setArticles(prev => {
                const ids = new Set<string>([id]);
                let changed = true;
                while (changed) {
                  changed = false;
                  for (const article of prev) {
                    if (article.parent_id && ids.has(article.parent_id) && !ids.has(article.id)) {
                      ids.add(article.id);
                      changed = true;
                    }
                  }
                }
                return prev
                  .filter(a => !ids.has(a.id))
                  .map((a, index) => ({ ...a, sort_index: index + 1 }));
              })}
              onEnterSibling={id => {
                const a = articles.find(x => x.id === id);
                if (!a) return;
                addNode(a.article_type, id);
              }}
              onDemote={id => {
                const sorted = [...articles].sort((a, b) => a.sort_index - b.sort_index);
                const idx = sorted.findIndex(x => x.id === id);
                if (idx <= 0) return;
                const prev = sorted[idx - 1];
                setArticles(sorted.map(a => a.id === id ? { ...a, parent_id: prev.id } : a));
              }}
            />
          </div>
        </section>

        <aside className="space-y-4">
          <div className="card p-4 space-y-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>批量文件匯入</h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                可一次選取多份 Word/PDF。系統會解析「第○章」「第○節」「第○條」，並自動抓取文件前段的歷史沿革。
              </p>
            </div>
            <input
              type="file"
              multiple
              accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
              onChange={e => setImportFiles(Array.from(e.target.files ?? []))}
              className="w-full text-xs"
              style={{ color: "var(--text-secondary)" }}
            />
            {importFiles.length > 0 && (
              <div className="rounded-lg p-2 text-xs space-y-1"
                style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                <p>已選取 {importFiles.length} 份文件</p>
                {importFiles.slice(0, 4).map(file => (
                  <p key={`${file.name}-${file.size}`} className="truncate">・{file.name}</p>
                ))}
                {importFiles.length > 4 && <p>・另有 {importFiles.length - 4} 份</p>}
              </div>
            )}
            <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: "var(--text-secondary)" }}>
              <input
                type="checkbox"
                checked={publishImported}
                onChange={e => setPublishImported(e.target.checked)}
                className="mt-0.5"
              />
              <span>匯入後直接標記為現行公開法規，並建立「匯入既有現行法規」修訂快照</span>
            </label>
            <button
              onClick={importDocxDrafts}
              disabled={importing || !selectedOrgId || importFiles.length === 0}
              className="w-full py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}
            >
              {importing ? "匯入中..." : `批量匯入 ${importFiles.length || ""} 份文件`}
            </button>
          </div>

          <div className="card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>建立草稿</h3>
            <button onClick={saveDraft} disabled={saving} className="w-full py-2.5 rounded-lg text-sm font-medium disabled:opacity-50" style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
              {saving ? "建立中..." : "建立草稿"}
            </button>
          </div>
        </aside>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="my-auto max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-xl p-4 space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
            <h3 className="text-sm font-semibold">編輯節點</h3>
            <input
              value={modal.title}
              onChange={e => setModal(p => p ? { ...p, title: e.target.value } : p)}
              placeholder="標題（選填）"
              className="text-sm px-2 py-1.5 rounded"
              style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
            />
            <textarea
              value={modal.content}
              onChange={e => setModal(p => p ? { ...p, content: e.target.value } : p)}
              rows={5}
              placeholder="內文"
              className="w-full text-sm px-2 py-1.5 rounded"
              style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="text-xs px-3 py-1.5 rounded" style={{ border: "1px solid var(--border)" }}>取消</button>
              <button
                onClick={() => {
                  setArticles(prev => prev.map(a => a.id === modal.id ? { ...a, title: modal.title, subtitle: "", content: modal.content } : a));
                  setModal(null);
                }}
                className="text-xs px-3 py-1.5 rounded"
                style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}
              >
                儲存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
