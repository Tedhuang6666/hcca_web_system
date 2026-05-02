"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { documentsApi, ApiError } from "@/lib/api";
import type { DocumentOut } from "@/lib/types";
import { DocumentStatusBadge, UrgencyBadge } from "@/components/ui/StatusBadge";
import { ApprovalPanel } from "@/components/documents/ApprovalPanel";
import { VersionHistory } from "@/components/documents/VersionHistory";
import { useWS } from "@/hooks/useWS";

function fmtSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitMode, setSubmitMode] = useState(false);
  const [approverIds, setApproverIds] = useState<string>("");

  const fetchDoc = useCallback(async () => {
    try {
      const d = await documentsApi.get(id);
      setDoc(d);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "載入失敗");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchDoc(); }, [fetchDoc]);

  // 即時 WebSocket 更新
  useWS(doc ? `org:${doc.org_id}` : null, (msg) => {
    if (msg.type === "document_status_changed" && (msg as { document_id?: string }).document_id === id) {
      toast.info("公文狀態已更新");
      fetchDoc();
    }
  }, !!doc);

  const handleApprove = async (comment: string) => {
    await documentsApi.approve(id, comment || undefined);
    toast.success("已核准");
    fetchDoc();
  };

  const handleReject = async (comment: string, mode: "to_creator" | "to_previous") => {
    await documentsApi.reject(id, comment, mode);
    toast.success("已退件");
    fetchDoc();
  };

  const handleRecall = async () => {
    try { await documentsApi.recall(id); toast.success("已撤回"); fetchDoc(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "操作失敗"); }
  };

  const handleSubmit = async () => {
    const ids = approverIds.split(",").map(s => s.trim()).filter(Boolean);
    if (!ids.length) { toast.error("請輸入至少一個審核人 ID"); return; }
    try { await documentsApi.submit(id, ids); toast.success("已送審"); fetchDoc(); setSubmitMode(false); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "送審失敗"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-500">載入中...</div>;
  if (!doc) return <div className="text-center text-red-400 mt-20">公文不存在或無權限查看</div>;

  const canApprove = doc.status === "pending" && doc.approvals.some(a => a.status === "pending");

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* 頂部 */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link href="/documents" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-200"
            style={{ border: "1px solid var(--border)" }}>←</Link>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-sm font-mono" style={{ color: "var(--accent)" }}>{doc.serial_number}</span>
              <DocumentStatusBadge status={doc.status} />
              <UrgencyBadge urgency={doc.urgency} />
            </div>
            <h1 className="text-xl font-semibold text-slate-100">{doc.title}</h1>
          </div>
        </div>
        <div className="flex gap-2">
          {doc.status === "draft" && !submitMode && (
            <button onClick={() => setSubmitMode(true)} className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "rgba(251,146,60,0.15)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.3)" }}>
              ✉ 送審
            </button>
          )}
          {doc.status === "pending" && (
            <button onClick={handleRecall} className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "rgba(148,163,184,0.1)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.3)" }}>
              ↩ 撤回
            </button>
          )}
          {doc.status === "approved" && (
            <button onClick={async () => { await documentsApi.archive(id); fetchDoc(); }}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "rgba(71,85,105,0.1)", color: "#475569", border: "1px solid rgba(71,85,105,0.3)" }}>
              📦 封存
            </button>
          )}
        </div>
      </div>

      {/* 送審設定列 */}
      {submitMode && (
        <div className="glass p-4 flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--muted)" }}>審核人 ID（逗號分隔，按順序）</span>
          <input value={approverIds} onChange={e => setApproverIds(e.target.value)} placeholder="uuid1, uuid2..."
            className="flex-1 bg-transparent text-slate-300 text-sm px-2 py-1 rounded outline-none"
            style={{ border: "1px solid var(--border)" }} />
          <button onClick={handleSubmit} className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "rgba(251,146,60,0.15)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.3)" }}>
            確認送審
          </button>
          <button onClick={() => setSubmitMode(false)} className="text-sm px-3" style={{ color: "var(--muted)" }}>取消</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 左：公文內容 */}
        <div className="lg:col-span-2 space-y-4">
          {/* 元資料 */}
          <div className="glass p-4">
            <dl className="grid grid-cols-2 gap-3 text-xs">
              {[
                ["發文機關", doc.issuer_org_name ?? "—"],
                ["類別", doc.category === "letter" ? "函" : "令"],
                ["建立日期", new Date(doc.created_at).toLocaleDateString("zh-TW")],
                ["送審日期", doc.submitted_at ? new Date(doc.submitted_at).toLocaleDateString("zh-TW") : "—"],
                ["限辦日期", doc.due_date ? new Date(doc.due_date).toLocaleDateString("zh-TW") : "—"],
                ["承辦人", doc.handler_name ? `${doc.handler_name}${doc.handler_unit ? ` / ${doc.handler_unit}` : ""}` : "—"],
              ].map(([k, v]) => (
                <div key={k}><dt style={{ color: "var(--muted)" }}>{k}</dt><dd className="mt-0.5 text-slate-300">{v}</dd></div>
              ))}
            </dl>
          </div>

          {/* 受文者 */}
          {doc.recipients.length > 0 && (
            <div className="glass p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>受文者</h3>
              <div className="flex flex-wrap gap-2">
                {doc.recipients.map(r => (
                  <span key={r.id} className="text-xs px-2.5 py-1 rounded-full"
                    style={{ color: "var(--accent)", background: "var(--accent-dim)", border: "1px solid var(--border-glow)" }}>
                    {{ main: "受文者", primary: "正本", copy: "副本" }[r.recipient_type]} {r.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 公文本文 */}
          <div className="glass p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--muted)" }}>公文內容</h3>
            <div className="text-sm text-slate-300 space-y-4 leading-relaxed">
              {doc.subject && <div><p className="font-semibold text-slate-100 mb-1">一、主旨</p><p>{doc.subject}</p></div>}
              {doc.doc_description && <div><p className="font-semibold text-slate-100 mb-1">二、說明</p><p>{doc.doc_description}</p></div>}
              {doc.action_required && <div><p className="font-semibold text-slate-100 mb-1">三、辦法</p><p>{doc.action_required}</p></div>}
              {!doc.subject && !doc.doc_description && !doc.action_required && doc.content && (
                <pre className="whitespace-pre-wrap font-mono text-xs">{doc.content}</pre>
              )}
            </div>
          </div>

          {/* 附件 */}
          {doc.attachments.length > 0 && (
            <div className="glass p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--muted)" }}>附件</h3>
              <ul className="space-y-2">
                {doc.attachments.map(a => (
                  <li key={a.id} className="flex items-center justify-between text-xs px-3 py-2 rounded"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-2 text-slate-300">
                      <span>📎</span><span>{a.filename}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span style={{ color: "var(--muted)" }}>{fmtSize(a.file_size)}</span>
                      {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>下載</a>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 版本歷程 */}
          <VersionHistory revisions={doc.revisions} />
        </div>

        {/* 右：審核面板 */}
        <div className="space-y-4">
          {doc.approvals.length > 0
            ? <ApprovalPanel steps={doc.approvals} canApprove={canApprove}
                onApprove={handleApprove} onReject={handleReject} />
            : <div className="glass p-4 text-xs text-center" style={{ color: "var(--muted)" }}>
                尚未設定審核人
              </div>
          }
        </div>
      </div>
    </div>
  );
}
