"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { regulationsApi, apiErrorMessage } from "@/lib/api";
import type { RegulationOut } from "@/lib/types";
import {
  ARTICLE_TYPE_LABEL,
  buildDraftComparisonRows,
  fallbackTreeContent,
  type Draft,
} from "./amendmentDraftUtils";

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
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 16));
  const [timeMachine, setTimeMachine] = useState<{ version: number; amended_at: string; content_snapshot: string } | null>(null);
  const comparisonRows = buildDraftComparisonRows(draft);
  const autoSummary = comparisonRows
    .map(row => `${row.status}：${row.revised_text !== "—" ? row.revised_text : row.current_text}${row.note ? `\n說明：${row.note}` : ""}`)
    .join("\n\n");
  const changes = summaryOverride.trim() || autoSummary;

  const warnings = useMemo(() => {
    const items = fallbackTreeContent(draft);
    const legalNumbers = new Set(
      items
        .filter(item => item.article_type === "article" && item.legal_number)
        .map(item => String(item.legal_number).trim())
        .filter(Boolean),
    );
    const pattern = /第\s*(\d+(?:-\d+)?)\s*條/g;
    const rows: Array<{ source_article_id: string; source_title: string; referenced_legal_number: string; message: string }> = [];
    for (const item of items) {
      if (!item.content) continue;
      const matches = item.content.matchAll(pattern);
      for (const match of matches) {
        const ref = match[1];
        if (ref && !legalNumbers.has(ref)) {
          rows.push({
            source_article_id: item.id,
            source_title: item.title || ARTICLE_TYPE_LABEL[item.article_type] || "未命名條文",
            referenced_legal_number: ref,
            message: `參照的第 ${ref} 條不存在或已被刪除`,
          });
        }
      }
    }
    return rows;
  }, [draft]);

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

  const handleExportPdf = async () => {
    if (comparisonRows.length === 0) {
      toast.error("目前沒有可匯出的條文異動");
      return;
    }
    try {
      const blob = await regulationsApi.exportAmendmentComparisonPdf(reg.id, {
        proposal_title: `${reg.title}部分條文修正草案對照表`,
        rationale: rationale.trim() || null,
        rows: comparisonRows.map(row => ({
          article_key: row.article_key,
          status: row.status,
          revised_text: row.revised_text,
          current_text: row.current_text,
          note: row.note?.trim() || row.status,
        })),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${reg.title}_${draft.name}_修正條文對照表.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("修正條文對照表已匯出");
    } catch (e) {
      toast.error(apiErrorMessage(e, "匯出 PDF 失敗"));
    }
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
      const forkArticles = latest.articles.filter(article => !article.is_deleted);
      const forkByLineage = new Map(
        forkArticles
          .filter(article => article.lineage_id)
          .map(article => [article.lineage_id, article]),
      );
      const draftItems = fallbackTreeContent(draft).slice().sort((a, b) => a.sort_index - b.sort_index);

      const idMap = new Map<string, string>();
      const keptForkIds = new Set<string>();
      for (const item of draftItems) {
        const existing = item.lineage_id ? forkByLineage.get(item.lineage_id) : undefined;
        if (existing) {
          idMap.set(item.id, existing.id);
          keptForkIds.add(existing.id);
        }
      }

      for (let index = 0; index < draftItems.length; index += 1) {
        const item = draftItems[index];
        const parentRealId = item.parent_id ? (idMap.get(item.parent_id) ?? null) : null;
        const existingId = idMap.get(item.id);
        if (existingId) {
          await regulationsApi.updateArticle(draftReg.id, existingId, {
            sort_index: index + 1,
            order_index: item.order_index,
            parent_id: parentRealId,
            article_type: item.article_type,
            title: item.title,
            content: item.content,
            legal_number: item.legal_number ?? undefined,
          });
        } else {
          const created = await regulationsApi.addArticle(draftReg.id, {
            sort_index: index + 1,
            order_index: item.order_index,
            parent_id: parentRealId,
            article_type: item.article_type,
            title: item.title || undefined,
            subtitle: undefined,
            content: item.content || undefined,
            legal_number: item.legal_number ?? undefined,
          });
          idMap.set(item.id, created.id);
        }
      }

      for (const article of forkArticles) {
        if (!keptForkIds.has(article.id)) {
          await regulationsApi.deleteArticle(draftReg.id, article.id, false);
        }
      }

      await regulationsApi.autoRenumber(draftReg.id, false);
      toast.success("已建立修正草案，請在草案頁面確認內容後送審");
      onDone(draftReg.id);
    } catch (e) {
      toast.error(apiErrorMessage(e, "建立草案失敗"));
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
        <button onClick={handleExportPdf}
          className="text-sm px-4 py-2 rounded-lg hover:opacity-80 inline-flex items-center gap-1.5"
          style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/>
          </svg>
          匯出對照表 PDF
        </button>
        <button onClick={handleSubmit} disabled={submitting || !brief.trim() || !rationale.trim()}
          className="btn btn-primary text-sm px-5 ml-auto disabled:opacity-40">
          {submitting ? "送審中…" : "直接送法規審核 →"}
        </button>
      </div>
    </div>
  );
}
