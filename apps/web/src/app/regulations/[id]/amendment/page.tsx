"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  StepDraftList,
  StepEditTree,
  StepSubmit,
  articleToContent,
  articleToTreeArticle,
  loadDrafts,
  newId,
  saveDrafts,
  type AmendmentType,
  type Draft,
  type DraftStatus } from "@/components/regulations/AmendmentDraftParts";
import { usePermissions } from "@/hooks/usePermissions";
import { regulationsApi, regulationHref, apiErrorMessage } from "@/lib/api";
import type { RegulationOut } from "@/lib/types";

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function DraftAmendmentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = usePermissions();

  const [reg, setReg] = useState<RegulationOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDraftName, setNewDraftName] = useState("修正草案");
  const [newDraftType, setNewDraftType] = useState<AmendmentType>("partial");

  const activeDraft = drafts.find(d => d.id === activeDraftId) ?? null;
  const currentRegHref = reg ? regulationHref(reg) : `/regulations/${encodeURIComponent(id)}`;

  // 載入法規
  useEffect(() => {
    setNewDraftName(`${new Date().toLocaleDateString("zh-TW")} 修正草案`);
    regulationsApi.get(id)
      .then(r => { setReg(r); setLoading(false); })
      .catch(e => { toast.error(apiErrorMessage(e, "載入失敗")); setLoading(false); });
  }, [id]);

  // 從 localStorage 載入草案
  useEffect(() => { setDrafts(loadDrafts(id)); }, [id]);

  const persistDrafts = useCallback((next: Draft[]) => {
    setDrafts(next);
    saveDrafts(id, next);
  }, [id]);

  // 建立新草案
  const createDraft = () => {
    const name = newDraftName.trim();
    if (!name) {
      toast.error("請輸入草案名稱");
      return;
    }
    const type = newDraftType;
    const articles = reg?.articles ?? [];
    const draftId = newId();
    const draft: Draft = {
      id: draftId, name: name.trim(), amendmentType: type, updatedAt: new Date().toISOString(),
      partialContent: type === "partial"
        ? articles.filter(a => !a.is_deleted).map(a => ({
            id: newId(), status: "unchanged" as DraftStatus, comment: "",
            current: articleToContent(a), originalContent: articleToContent(a),
          }))
        : [],
      fullContent: type === "full"
        ? articles.filter(a => !a.is_deleted).map(articleToContent)
        : [],
      treeContent: articles.filter(a => !a.is_deleted).map(articleToTreeArticle),
      originalTreeContent: articles.filter(a => !a.is_deleted).map(articleToTreeArticle),
    };
    persistDrafts([...drafts, draft]);
    setActiveDraftId(draftId);
    setShowCreateForm(false);
    setStep(2);
  };

  const handleNew = () => setShowCreateForm(true);

  const handleOpen = (draftId: string) => {
    setActiveDraftId(draftId);
    setStep(2);
  };

  const handleDelete = (draftId: string) => {
    const draft = drafts.find(d => d.id === draftId);
    if (draft && !window.confirm(`確定刪除「${draft.name}」？此操作只會刪除本機草稿。`)) {
      return;
    }
    persistDrafts(drafts.filter(d => d.id !== draftId));
    if (activeDraftId === draftId) { setActiveDraftId(null); setStep(1); }
    toast.success("修正案草稿已刪除");
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target?.result as string);
        const importedDraft: Draft = data.draft ?? data;
        if (!importedDraft.id || !importedDraft.name) { toast.error("無效的草案格式"); return; }
        importedDraft.id = newId();
        importedDraft.name = `${importedDraft.name}（匯入）`;
        importedDraft.updatedAt = new Date().toISOString();
        persistDrafts([...drafts, importedDraft]);
        toast.success(`已匯入草案「${importedDraft.name}」`);
      } catch { toast.error("解析失敗，請確認格式"); }
    };
    reader.readAsText(file);
  };

  const updateDraft = useCallback((updater: (prev: Draft) => Partial<Draft>) => {
    setDrafts(prev => {
      const next = prev.map(d => d.id !== activeDraftId ? d : { ...d, ...updater(d), updatedAt: new Date().toISOString() });
      saveDrafts(id, next);
      return next;
    });
  }, [activeDraftId, id]);

  if (loading) return <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>載入中...</div>;
  if (!reg) return <div className="py-20 text-center" style={{ color: "var(--danger)" }}>法規不存在</div>;

  if (!can("regulation:create") && !can("regulation:admin")) {
    return (
      <div className="py-20 text-center space-y-3">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>您沒有起草修正案的權限</p>
        <Link href={currentRegHref} className="btn btn-ghost text-sm">← 返回法規</Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* 頂部 */}
      <div className="flex items-start gap-3">
        <Link href={currentRegHref}
          className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center hover:opacity-80 mt-1"
          style={{ border: "1px solid var(--border)" }}>←</Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            {reg.title} — 修正草案編輯
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            草案儲存於本機瀏覽器，提交後將建立公文提案。
          </p>
        </div>
      </div>

      {/* 步驟指示器 */}
      <div className="flex items-center gap-0 overflow-x-auto">
        {([
          { n: 1 as const, label: "草案列表" },
          { n: 2 as const, label: activeDraft ? `編輯：${activeDraft.name}` : "選取草案" },
          { n: 3 as const, label: "提交草案" },
        ] as const).map(({ n, label }, i) => (
          <div key={n} className="flex items-center flex-shrink-0">
            {i > 0 && (
              <div className="w-8 h-0.5" style={{ background: step > i ? "var(--primary)" : "var(--border)" }} />
            )}
            <button
              disabled={n === 2 && !activeDraftId}
              onClick={() => {
                if (n === 1) { setStep(1); setActiveDraftId(null); }
                else if (n === 2 && activeDraftId) setStep(2);
                else if (n === 3 && activeDraftId) setStep(3);
              }}
              className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-80">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                style={{
                  background: step === n ? "var(--primary)" : step > n ? "var(--success)" : "var(--bg-elevated)",
                  color: step >= n ? "white" : "var(--text-muted)",
                  border: step < n ? "1px solid var(--border)" : "none",
                }}>
                {step > n ? "✓" : n}
              </span>
              <span style={{ color: step === n ? "var(--primary)" : "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</span>
            </button>
          </div>
        ))}
      </div>

      {/* 步驟內容 */}
      {step === 1 && (
        <>
          <StepDraftList
            drafts={drafts}
            onOpen={handleOpen} onNew={handleNew}
            onDelete={handleDelete} onImport={handleImport}
          />
          {showCreateForm && (
            <div className="card p-4 space-y-3">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>建立修正草案</p>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "var(--text-secondary)" }}>草案名稱</label>
                <input
                  value={newDraftName}
                  onChange={e => setNewDraftName(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "var(--text-secondary)" }}>修正類型</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setNewDraftType("partial")} className="text-xs px-3 py-1.5 rounded-lg"
                    style={newDraftType === "partial"
                      ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }
                      : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    部分修正
                  </button>
                  <button type="button" onClick={() => setNewDraftType("full")} className="text-xs px-3 py-1.5 rounded-lg"
                    style={newDraftType === "full"
                      ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }
                      : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    全文修正
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreateForm(false)} className="text-xs px-3 py-1.5 rounded-lg"
                  style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                  取消
                </button>
                <button type="button" onClick={createDraft} className="text-xs px-3 py-1.5 rounded-lg"
                  style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                  建立草案
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {step === 2 && activeDraft && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{activeDraft.name}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {activeDraft.amendmentType === "partial" ? "部分修正" : "全文修正"} ·
                最後修改 {new Date(activeDraft.updatedAt).toLocaleString("zh-TW")}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleDelete(activeDraft.id)}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg hover:opacity-80"
                style={{ color: "var(--danger)", border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.08)" }}
              >
                <Trash2 size={13} strokeWidth={2.2} aria-hidden="true" />
                刪除草案
              </button>
              <button onClick={() => { setStep(1); setActiveDraftId(null); }}
                className="text-xs px-3 py-1.5 rounded-lg hover:opacity-80"
                style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                ← 返回列表
              </button>
              <button onClick={() => setStep(3)}
                className="text-xs px-3 py-1.5 rounded-lg hover:opacity-90 font-medium"
                style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                完成編輯 →
              </button>
            </div>
          </div>

          <StepEditTree
            draft={activeDraft}
            onUpdate={items => updateDraft(() => ({
              treeContent: items,
              fullContent: items.map((item, index) => ({
                article_type: item.article_type,
                title: item.title,
                content: item.content,
                order_index: index,
              })),
            }))}
          />
        </div>
      )}

      {step === 3 && activeDraft && (
        <StepSubmit
          draft={activeDraft}
          reg={reg}
          onBack={() => setStep(2)}
          onDone={(draftRegId) => router.push(`/regulations/${draftRegId}/edit`)}
          onUpdateDraft={updateDraft}
        />
      )}
    </div>
  );
}
