"use client";
import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { documentsApi, usersApi, ApiError } from "@/lib/api";
import type { UserSummary } from "@/lib/api";
import type { DocumentOut } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";
import { DocumentStatusBadge, UrgencyBadge } from "@/components/ui/StatusBadge";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { OfficialText } from "@/components/ui/OfficialText";
import { ApprovalPanel } from "@/components/documents/ApprovalPanel";
import { VersionHistory } from "@/components/documents/VersionHistory";
import { usePersistedZoom } from "@/hooks/usePersistedZoom";
import { useWS } from "@/hooks/useWS";
import { apiUrl } from "@/lib/config";
import { recordRecent } from "@/lib/recents";

function toROCDate(dateStr: string) {
  const d = new Date(dateStr);
  const y = d.getFullYear() - 1911;
  return `中華民國 ${y} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

const CAT_LABEL: Record<string, string> = {
  letter: "函", decree: "令", announcement: "公告", report: "報告",
  record: "紀錄", consultation: "咨", meeting_notice: "開會通知單", other: "其他",
};
const CLASS_LABEL: Record<string, string> = { normal: "普通", confidential: "密", secret: "機密" };
const URGENCY_LABEL: Record<string, string> = { normal: "普通件", priority: "速件", express: "最速件" };

function fmtSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function filenameFromContentDisposition(disposition: string | null, fallback: string) {
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

function formatActingSignature(step: DocumentOut["approvals"][number] | undefined) {
  if (!step) return null;
  if (!step.is_acting || !step.delegate) {
    const signer = step.approver;
    return {
      title: step.approver_title ?? "簽核人",
      name: signer.name ?? signer.email?.split("@")[0] ?? "",
    };
  }
  const principal = step.approver_title
    ? `${step.approver.name}（${step.approver_title}）`
    : step.approver.name;
  const delegate = step.delegate_title
    ? `${step.delegate.name}（${step.delegate_title}）`
    : step.delegate.name;
  return {
    title: "代理簽署",
    name: `${principal}假 ${delegate}代`,
  };
}

// ── 使用者選取器 ──────────────────────────────────────────────────────────────

const UserPicker = memo(function UserPicker({
  selectedIds, onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    usersApi.list().then(setUsers).catch(() => {});
  }, []);

  const filtered = useMemo(
    () => users.filter(u =>
      u.display_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
    ),
    [users, search]
  );

  const toggle = (uid: string) =>
    onChange(selectedIds.includes(uid)
      ? selectedIds.filter(x => x !== uid)
      : [...selectedIds, uid]);

  return (
    <div className="space-y-2">
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="搜尋姓名或 Email..."
        className="w-full bg-transparent  text-xs px-2 py-1.5 rounded outline-none"
        style={{ border: "1px solid var(--border)" }}
      />
      <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
        {filtered.length === 0 && (
          <p className="text-xs text-center py-3" style={{ color: "var(--text-muted)" }}>無符合的使用者</p>
        )}
        {filtered.map(u => {
          const selected = selectedIds.includes(u.id);
          const idx = selectedIds.indexOf(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors"
              style={selected
                ? { background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }
                : { background: "var(--bg-elevated)", border: "1px solid transparent" }}
            >
              <span className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                style={{ background: selected ? "var(--primary)" : "var(--bg-surface)", color: selected ? "var(--primary-fg)" : "var(--text-muted)" }}>
                {selected ? idx + 1 : ""}
              </span>
              <div className="flex-1 min-w-0">
                <p className=" truncate">{u.display_name}</p>
                <p className="truncate" style={{ color: "var(--text-muted)" }}>{u.email}</p>
              </div>
              {selected && <span style={{ color: "var(--primary)" }}>✓</span>}
            </button>
          );
        })}
      </div>
      {selectedIds.length > 0 && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          已選 {selectedIds.length} 位，按選取順序作為簽核層級
        </p>
      )}
    </div>
  );
});

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<DocumentOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [submitMode, setSubmitMode] = useState(false);
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [allUsers, setAllUsers] = useState<UserSummary[]>([]);
  const { zoom, setZoom, zoomStyle } = usePersistedZoom("hcca.viewer.zoom");
  const [printingPdf, setPrintingPdf] = useState(false);
  const { can } = usePermissions();
  const currentUserId = typeof window !== "undefined" ? localStorage.getItem("user_id") ?? "" : "";

  const fetchDoc = useCallback(async () => {
    try {
      const d = await documentsApi.get(id);
      setDoc(d);
      setForbidden(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(true);
      } else {
        setForbidden(false);
        toast.error(e instanceof ApiError ? e.message : "載入失敗");
      }
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchDoc(); }, [fetchDoc]);
  useEffect(() => { usersApi.list().then(setAllUsers).catch(() => {}); }, []);
  useEffect(() => {
    if (doc) recordRecent({ kind: "document", id, title: doc.serial_number ?? doc.title, href: `/documents/${id}` });
  }, [doc, id]);

  // 即時 WebSocket 更新
  useWS(doc ? `org:${doc.org_id}` : null, (msg) => {
    if (msg.type === "document_status_changed" &&
      (msg as { document_id?: string }).document_id === id) {
      toast.info("公文狀態已更新");
      fetchDoc();
    }
  }, !!doc);

  const handleApprove = async (comment: string) => {
    await documentsApi.approve(id, comment || undefined);
    toast.success("已核准");
    router.refresh();
    fetchDoc();
  };

  const handleSetDelegate = async (stepOrder: number, delegateId: string | null) => {
    try {
      await documentsApi.setDelegate(id, stepOrder, delegateId);
      toast.success(delegateId ? "代理人已設定" : "代理人已清除");
      router.refresh();
      fetchDoc();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "操作失敗"); }
  };

  const handleReject = async (comment: string, mode: "to_creator" | "to_previous") => {
    await documentsApi.reject(id, comment, mode);
    toast.success("已退件");
    router.refresh();
    fetchDoc();
  };

  const handleRecall = async () => {
    try { await documentsApi.recall(id); toast.success("已撤回"); fetchDoc(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "操作失敗"); }
  };

  const handleSubmit = async () => {
    if (!approverIds.length) { toast.error("請選取至少一位審核人"); return; }
    try {
      await documentsApi.submit(id, approverIds);
      toast.success("已送審");
      fetchDoc();
      setSubmitMode(false);
      setApproverIds([]);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "送審失敗"); }
  };

  const handleIssueDirect = async () => {
    if (!confirm("確定要直接發文嗎？此操作將跳過審核流程，公文將直接設為「已核准」。")) return;
    try {
      await documentsApi.issueDirect(id);
      toast.success("已直接發文");
      fetchDoc();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "操作失敗"); }
  };

  // 進入送審模式時自動載入建議審核人
  const enterSubmitMode = async () => {
    setSubmitMode(true);
    try {
      const suggestions = await documentsApi.suggestApprovers(id);
      if (suggestions.length > 0) {
        setApproverIds(suggestions.map(u => u.id));
        toast.info(`已自動帶入 ${suggestions.length} 位建議審核人`);
      }
    } catch { /* 查無建議審核人時靜默失敗 */ }
  };

  const uploadFile = async (file: File) => {
    setUploadingFile(true);
    try {
      await documentsApi.uploadAttachment(id, file);
      toast.success(`已上傳 ${file.name}`);
      fetchDoc();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "上傳失敗");
    } finally { setUploadingFile(false); }
  };

  const deleteAttachment = async (attId: string) => {
    try {
      await documentsApi.deleteAttachment(id, attId);
      toast.success("附件已刪除");
      fetchDoc();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "刪除失敗");
    }
  };

  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkText, setNewLinkText] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [editingAttachmentId, setEditingAttachmentId] = useState<string | null>(null);
  const [editingAttachmentName, setEditingAttachmentName] = useState("");
  const [showAllAttachments, setShowAllAttachments] = useState(false);
  const [showDocumentInfo, setShowDocumentInfo] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const addLink = async () => {
    if (!newLinkUrl.trim()) return;
    setAddingLink(true);
    try {
      await documentsApi.addLink(id, { url: newLinkUrl.trim(), display_text: newLinkText.trim() || undefined });
      setNewLinkUrl(""); setNewLinkText("");
      fetchDoc();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "新增連結失敗");
    } finally { setAddingLink(false); }
  };

  const renameAttachment = async (attId: string) => {
    const nextName = editingAttachmentName.trim();
    if (!nextName) return toast.error("附件名稱不可為空");
    try {
      await documentsApi.renameAttachment(id, attId, nextName);
      setEditingAttachmentId(null);
      setEditingAttachmentName("");
      toast.success("附件名稱已更新");
      fetchDoc();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失敗");
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64">載入中...</div>;
  if (forbidden) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" style={{ color: "var(--text-muted)" }}>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>此公文為機密文件</p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>您目前的權限無法瀏覽此公文內容</p>
    </div>
  );
  if (!doc) return <div className="text-center text-red-400 mt-20">公文不存在或無權限查看</div>;

  const isCreator = doc.created_by === currentUserId;
  const catLabel = CAT_LABEL[doc.category] ?? doc.category;
  const canApprove = can("document:approve") &&
    doc.status === "pending" &&
    doc.approvals.some(
      (a) => a.status === "pending"
        && (a.approver.id === currentUserId || a.delegate?.id === currentUserId),
    );
  const isDraft = doc.status === "draft";
  const docInfoRows: [string, string][] = [
    ["字號", doc.serial_number || "（未分配）"],
    ["類別", catLabel],
    ["密等", CLASS_LABEL[doc.classification] ?? doc.classification],
    ["建立日期", new Date(doc.created_at).toLocaleDateString("zh-TW")],
    ["送審日期", doc.submitted_at ? new Date(doc.submitted_at).toLocaleDateString("zh-TW") : "—"],
    ["限辦日期", doc.due_date ? new Date(doc.due_date).toLocaleDateString("zh-TW") : "—"],
    [
      "承辦人",
      doc.handler_name
        ? `${doc.handler_name}${doc.handler_unit ? ` / ${doc.handler_unit}` : ""}`
        : "—",
    ],
  ];
  const primaryRecipients = doc.recipients
    .filter(r => r.recipient_type === "main" || r.recipient_type === "primary");
  const recipientSummary = primaryRecipients.length > 0
    ? primaryRecipients.map(r => r.name).join("、")
    : "—";
  const isDecree = doc.category === "decree";
  const decreeBody = doc.doc_description || doc.content || doc.action_required || doc.subject;
  const attachmentNames = doc.attachments
    .map(a => a.display_name || a.filename)
    .filter(Boolean)
    .join("、");

  return (
    <>
    <div className="max-w-5xl mx-auto space-y-5">
      {/* 麵包屑 */}
      <Breadcrumb items={[
        { label: "公文系統", href: "/documents" },
        { label: doc.serial_number ?? doc.title },
      ]} />
      {/* 頂部 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Link href="/documents"
            className="w-8 h-8 rounded-lg flex flex-shrink-0 items-center justify-center  hover:"
            style={{ border: "1px solid var(--border)" }}>←</Link>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <span className="text-sm font-mono break-all" style={{ color: "var(--primary)" }}>
                {doc.serial_number}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <DocumentStatusBadge status={doc.status} />
                <UrgencyBadge urgency={doc.urgency} />
              </div>
            </div>
            <h1 className="text-lg font-semibold leading-snug break-words sm:text-xl">{doc.title}</h1>
          </div>
        </div>

        <div className="flex w-full flex-wrap justify-start gap-2 sm:w-auto sm:flex-shrink-0 sm:justify-end">
          {/* 縮放控制 */}
          <div className="flex items-center gap-0.5 rounded-lg overflow-hidden"
            style={{ border: "1px solid rgba(148,163,184,0.2)" }}>
            <button onClick={() => setZoom(z => Math.max(70, z - 10))}
              className="px-2 py-1.5 text-xs transition-colors hover:opacity-80"
              style={{ color: "#64748b" }} title="縮小">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <span className="text-xs px-1 select-none" style={{ color: "#64748b" }}>{zoom}%</span>
            <button onClick={() => setZoom(z => Math.min(150, z + 10))}
              className="px-2 py-1.5 text-xs transition-colors hover:opacity-80"
              style={{ color: "#64748b" }} title="放大">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
          </div>

          {/* 複製連結 */}
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                toast.success("連結已複製");
              } catch {
                toast.error("無法複製連結，請手動複製網址列");
              }
            }}
            className="topbar-icon-btn"
            title="複製連結">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </button>

          {/* 草稿：編輯（僅建立者） */}
          {isDraft && isCreator && (
            <Link href={`/documents/${id}/edit`} className="btn btn-ghost text-sm gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              編輯
            </Link>
          )}
          {/* 草稿：送審（僅建立者） */}
          {isDraft && isCreator && !submitMode && (
            <button onClick={enterSubmitMode} className="btn btn-primary text-sm gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
              送審
            </button>
          )}
          {/* 直接發文（需 document:issue_direct 權限） */}
          {isDraft && isCreator && can("document:issue_direct") && !submitMode && (
            <button onClick={handleIssueDirect} className="btn text-sm gap-1.5"
              style={{ background: "var(--success-dim)", color: "var(--success)", border: "1px solid var(--success)" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              逕行發文
            </button>
          )}
          {/* 待審：撤回（僅建立者） */}
          {doc.status === "pending" && isCreator && (
            <button onClick={handleRecall} className="btn btn-ghost text-sm gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.12"/>
              </svg>
              撤回
            </button>
          )}
          {/* 已核准：封存（僅建立者） */}
          {doc.status === "approved" && isCreator && (
            <button onClick={async () => { await documentsApi.archive(id); fetchDoc(); }}
              className="btn btn-ghost text-sm gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>
                <line x1="10" y1="12" x2="14" y2="12"/>
              </svg>
              封存
            </button>
          )}
          {/* 官式公文列印（後端格式，帶 token 避免 401） */}
          <button
            onClick={async () => {
              if (printingPdf) return;
              const toastId = toast.loading("正在處理檔案，請稍候...");
              setPrintingPdf(true);
              try {
                const res = await fetch(apiUrl(`/documents/${id}/print`), {
                  credentials: "include",
                });
                if (!res.ok) throw new Error(res.statusText);
                const blob = await res.blob();
                const fallbackName = `${doc.serial_number || doc.title || "公文"}.pdf`;
                const filename = filenameFromContentDisposition(
                  res.headers.get("Content-Disposition"),
                  fallbackName,
                );
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = filename;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
                toast.success("PDF 已下載", { id: toastId });
              } catch (e) {
                toast.error(`列印失敗${e instanceof Error && e.message ? `：${e.message}` : ""}`, { id: toastId });
              } finally {
                setPrintingPdf(false);
              }
            }}
            disabled={printingPdf}
            className="px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 transition-colors hover:opacity-90 disabled:opacity-60 disabled:cursor-wait"
            style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
            {printingPdf ? (
              <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M21 12a9 9 0 0 1-9 9"/>
                <path d="M3 12a9 9 0 0 1 9-9"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
            )}
            {printingPdf ? "正在處理檔案" : "列印公文"}
          </button>
        </div>
      </div>

      {/* 送審面板（含使用者選取器） */}
      {submitMode && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold ">設定審核人（按順序選取）</h3>
            <button onClick={() => { setSubmitMode(false); setApproverIds([]); }}
              className="text-xs px-3 py-1 rounded" style={{ color: "var(--text-muted)" }}>
              取消
            </button>
          </div>
          <UserPicker selectedIds={approverIds} onChange={setApproverIds} />
          <button onClick={handleSubmit} disabled={!approverIds.length}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-40"
            style={{ background: "rgba(251,146,60,0.15)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.3)" }}>
            確認送審（{approverIds.length} 位審核人）
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 左：公文內容 */}
        <div className="lg:col-span-2 space-y-4">
          {/* 公文本文（官式橫書格式） */}
          <div className="card overflow-hidden" style={zoomStyle}>
            <div className="px-5 py-3 space-y-2" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>公文內容</span>
                <span className="text-xs font-mono" style={{ color: "var(--primary)" }}>
                  {doc.serial_number || "未分配字號"}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                <span>{catLabel}</span>
                <span>{CLASS_LABEL[doc.classification] ?? doc.classification}</span>
                <span>{URGENCY_LABEL[doc.urgency] ?? doc.urgency}</span>
                <span>發文日期：{toROCDate(doc.completed_at ?? doc.submitted_at ?? doc.created_at)}</span>
                {(!isDecree || primaryRecipients.length > 0) && (
                  <span className="min-w-0 break-words">受文者：{recipientSummary}</span>
                )}
              </div>
            </div>

            {/* 官式公文標頭區塊 */}
            <div className="px-6 pt-5 pb-3" style={{
              borderBottom: "1px solid var(--border)",
            }}>
              {isDecree && (
                <div className="mb-4 text-center text-2xl tracking-[0.35em]" style={{ color: "var(--text-primary)" }}>
                  {doc.issuer_full_name && (
                    <span className="tracking-normal">{doc.issuer_full_name} </span>
                  )}
                  令
                </div>
              )}
              {/* 公文字號 + 發文日期 */}
              <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 break-words" style={{ color: "var(--text-secondary)" }}>
                  {isDecree ? "發文字號：" : "公文字號："}
                  <span className="font-mono font-semibold" style={{ color: "var(--primary)" }}>
                    {doc.serial_number || "（未分配）"}
                  </span>
                </span>
                <span className="sm:flex-shrink-0" style={{ color: "var(--text-secondary)" }}>
                  發文日期：{toROCDate(doc.completed_at ?? doc.submitted_at ?? doc.created_at)}
                </span>
              </div>
              {/* 密等 / 速別（非普通時顯示） */}
              {(doc.classification !== "normal" || doc.urgency !== "normal") && (
                <div className="flex items-center gap-6 mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                  {doc.classification !== "normal" && (
                    <span>密等：{CLASS_LABEL[doc.classification] ?? doc.classification}</span>
                  )}
                  {doc.urgency !== "normal" && (
                    <span>速別：{URGENCY_LABEL[doc.urgency] ?? doc.urgency}</span>
                  )}
                </div>
              )}
              {/* 受文者（函/令） */}
              {doc.category !== "announcement" && primaryRecipients.length > 0 && (
                <div className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                  受文者：{primaryRecipients.map(r => r.name).join("、")}
                </div>
              )}
            </div>

            <div
              className="p-6 space-y-5"
              style={{
                lineHeight: "2",
                fontSize: "0.9375rem",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
              }}>

              {/* 開會通知單：顯示結構化議程 */}
              {doc.category === "meeting_notice" ? (
                <div className="space-y-3 text-sm" style={{ color: "var(--text-primary)" }}>
                  {doc.meeting_purpose && (
                    <div className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-2">
                      <span className="flex-shrink-0">開會事由：</span>
                      <span className="min-w-0 break-words">{doc.meeting_purpose}</span>
                    </div>
                  )}
                  {doc.meeting_time && (
                    <div className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-2">
                      <span className="flex-shrink-0">開會時間：</span>
                      <span className="min-w-0 break-words">{(() => {
                        const d = new Date(doc.meeting_time);
                        const y = d.getFullYear() - 1911;
                        const m = d.getMonth() + 1;
                        const day = d.getDate();
                        const h = d.getHours().toString().padStart(2, "0");
                        const min = d.getMinutes().toString().padStart(2, "0");
                        const week = ["日","一","二","三","四","五","六"][d.getDay()];
                        return `中華民國${y}年${m}月${day}日（星期${week}）${h}時${min}分`;
                      })()}</span>
                    </div>
                  )}
                  {doc.meeting_location && (
                    <div className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-2">
                      <span className="flex-shrink-0">開會地點：</span>
                      <span className="min-w-0 break-words">{doc.meeting_location}</span>
                    </div>
                  )}
                  {doc.meeting_chairperson && (
                    <div className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-2">
                      <span className="flex-shrink-0">主持人：</span>
                      <span className="min-w-0 break-words">{doc.meeting_chairperson}</span>
                    </div>
                  )}
                  {doc.doc_description && (
                    <div>
                      <p className="mb-1">議事日程：</p>
                      <div style={{ paddingLeft: "2em" }}>
                        <OfficialText value={doc.doc_description} />
                      </div>
                    </div>
                  )}
                </div>
              ) : doc.category === "record" ? (
                <div className="space-y-3 text-sm" style={{ color: "var(--text-primary)" }}>
                  {doc.meeting_time && (
                    <div className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-2">
                      <span>時間：</span><span>{toROCDate(doc.meeting_time)}</span>
                    </div>
                  )}
                  {doc.meeting_location && (
                    <div className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-2">
                      <span>地點：</span><span>{doc.meeting_location}</span>
                    </div>
                  )}
                  {doc.meeting_chairperson && (
                    <div className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-2">
                      <span>主席：</span><span>{doc.meeting_chairperson}</span>
                    </div>
                  )}
                  {doc.handler_name && (
                    <div className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-2">
                      <span>記錄者：</span><span>{doc.handler_name}</span>
                    </div>
                  )}
                  {doc.doc_description && (
                    <div>
                      <p className="mb-1">討論事項：</p>
                      <div className="pl-[2em]"><OfficialText value={doc.doc_description} /></div>
                    </div>
                  )}
                  {doc.action_required && (
                    <div>
                      <p className="mb-1">決議：</p>
                      <div className="pl-[2em]"><OfficialText value={doc.action_required} /></div>
                    </div>
                  )}
                </div>
              ) : isDecree ? (
                <div className="space-y-5" style={{ color: "var(--text-primary)" }}>
                  {decreeBody && <OfficialText value={decreeBody} className="text-sm" />}
                  {attachmentNames && (
                    <div>
                      <p>附件：</p>
                      <div className="pl-[2em]">
                        <OfficialText value={attachmentNames} />
                      </div>
                    </div>
                  )}
                  {!decreeBody && !attachmentNames && (
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>（尚無令文內容）</p>
                  )}
                </div>
              ) : (
                <>
                  {doc.subject && (
                    <div>
                      <p style={{ color: "var(--text-primary)" }}>主旨：</p>
                      <div className="pl-[2em]" style={{ color: "var(--text-primary)" }}>
                        <OfficialText value={doc.subject} />
                      </div>
                    </div>
                  )}
                  {doc.doc_description && (
                    <div>
                      <p style={{ color: "var(--text-primary)" }}>
                        {doc.category === "announcement" ? "公告事項：" : doc.category === "report" ? "說明／分析：" : "說明："}
                      </p>
                      <div className="pl-[2em]" style={{ color: "var(--text-primary)" }}>
                        <OfficialText value={doc.doc_description} />
                      </div>
                    </div>
                  )}
                  {doc.action_required && (
                    <div>
                      <p style={{ color: "var(--text-primary)" }}>
                        {doc.category === "report" ? "建議事項：" : doc.category === "consultation" ? "辦法或事項：" : "辦法："}
                      </p>
                      <div className="pl-[2em]" style={{ color: "var(--text-primary)" }}>
                        <OfficialText value={doc.action_required} />
                      </div>
                    </div>
                  )}
                  {!doc.subject && !doc.doc_description && !doc.action_required && doc.content && (
                    <OfficialText value={doc.content} className="text-sm" />
                  )}
                </>
              )}

              {/* 簽署區（核准後顯示） — DECREE 使用大型置中署名，仿正式公文視覺 */}
              {(doc.status === "approved" || doc.status === "archived") && (() => {
                const isDecree = doc.category === "decree";
                const approved = doc.approvals
                  .filter(a => a.status === "approved")
                  .sort((a, b) => b.step_order - a.step_order);
                const step = approved[0];
                const signature = formatActingSignature(step);
                const sigTitle = signature?.title ?? doc.handler_unit ?? "";
                const sigName = signature?.name ?? doc.handler_name ?? "";
                const issuedDate = doc.issued_at
                  ? (() => {
                      const d = new Date(doc.issued_at);
                      return `中華民國 ${d.getFullYear() - 1911} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
                    })()
                  : "";

                if (isDecree && sigName) {
                  return (
                    <div
                      className="mt-12 pt-8"
                      style={{ borderTop: "2px double var(--border-strong)" }}
                    >
                      <div className="flex flex-col items-center text-center space-y-4">
                        {sigTitle && (
                          <p
                            className="text-base sm:text-lg font-semibold tracking-[0.4em]"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {sigTitle}
                          </p>
                        )}
                        <p
                          className="font-bold tracking-[0.3em]"
                          style={{
                            color: "var(--primary)",
                            fontSize: "clamp(3rem, 8vw, 5.5rem)",
                            lineHeight: 1.05,
                          }}
                        >
                          {sigName}
                        </p>
                        <div
                          className="inline-flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28 rounded-full text-sm font-medium"
                          style={{
                            border: "3px solid var(--primary)",
                            color: "var(--primary)",
                            opacity: 0.55,
                            letterSpacing: "0.2em",
                          }}
                        >
                          蓋章處
                        </div>
                        {issuedDate && (
                          <p
                            className="text-sm font-medium mt-2"
                            style={{ color: "var(--text-secondary)", letterSpacing: "0.15em" }}
                          >
                            {issuedDate}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }

                // 一般公文：右下角小型署名
                return (
                  <div className="mt-8 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
                    <div className="flex justify-end">
                      <div className="text-right space-y-2">
                        {sigName ? (
                          <>
                            {sigTitle && (
                              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{sigTitle}</p>
                            )}
                            <p className="text-3xl tracking-[0.15em]" style={{ color: "var(--primary)" }}>
                              {sigName}
                            </p>
                            <p className="text-xs" style={{ color: "var(--text-muted)" }}>（蓋章處）</p>
                          </>
                        ) : (
                          <p className="text-xs" style={{ color: "var(--text-muted)" }}>（蓋章處）</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="no-print flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowDocumentInfo(v => !v)}
              className="btn btn-ghost btn-sm"
            >
              {showDocumentInfo ? "收合公文資料" : "公文資料"}
            </button>
            <button
              type="button"
              onClick={() => setShowAttachments(v => !v)}
              className="btn btn-ghost btn-sm"
            >
              {showAttachments ? "收合附件" : `附件 ${doc.attachments.length ? `(${doc.attachments.length})` : ""}`}
            </button>
            <button
              type="button"
              onClick={() => setShowVersions(v => !v)}
              className="btn btn-ghost btn-sm"
            >
              {showVersions ? "收合歷程" : `版本歷程 ${doc.revisions.length ? `(${doc.revisions.length})` : ""}`}
            </button>
          </div>

          {doc.regulation_id && (
            <div
              className="card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderColor: "var(--border-strong)" }}
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  關聯法規
                </p>
                <p className="text-sm mt-1" style={{ color: "var(--text-primary)" }}>
                  此公文是法規公布或處理流程的一部分
                </p>
              </div>
              <Link
                href={`/regulations/${encodeURIComponent(doc.regulation_id)}`}
                className="btn btn-ghost btn-sm justify-center"
              >
                查看法規
              </Link>
            </div>
          )}

          {showDocumentInfo && (
            <div className="card p-4">
              <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                {docInfoRows.map(([k, v]) => (
                  <div key={k}>
                    <dt style={{ color: "var(--text-muted)" }}>{k}</dt>
                    <dd className="mt-0.5" style={{ color: "var(--text-primary)" }}>{v}</dd>
                  </div>
                ))}
              </dl>
              {doc.handler_email && (
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  聯絡：{doc.handler_email}
                </p>
              )}
              {doc.recipients.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                  {doc.recipients.map(r => (
                    <span key={r.id} className="text-xs px-2.5 py-1 rounded-full"
                      style={{ color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}>
                      {{ main: "受文者", primary: "正本", copy: "副本" }[r.recipient_type]} {r.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 附件 */}
          {showAttachments && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                附件 {doc.attachments.length > 0 && `(${doc.attachments.length})`}
              </h3>
              {isDraft && (
                <label className={`text-xs cursor-pointer px-2.5 py-1 rounded transition-opacity hover:opacity-80
                  ${uploadingFile ? "opacity-40 pointer-events-none" : ""}`}
                  style={{ color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}>
                  <input type="file" className="hidden" disabled={uploadingFile}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
                  {uploadingFile ? "上傳中..." : "＋ 上傳附件"}
                </label>
              )}
            </div>
            {doc.attachments.length === 0
              ? <p className="text-xs" style={{ color: "var(--text-muted)" }}>尚無附件</p>
              : (
                <>
                <ul className="space-y-2">
                  {(showAllAttachments ? doc.attachments : doc.attachments.slice(0, 3)).map(a => {
                    const isLink = Boolean(a.link_url);
                    const isImg = !isLink && (
                      /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.filename) ||
                      (a.content_type?.startsWith("image/") ?? false)
                    );
                    const isPdf = !isLink && (
                      /\.pdf$/i.test(a.filename) || a.content_type === "application/pdf"
                    );
                    const fileUrl = documentsApi.attachmentDownloadUrl(id, a.id);
                    const previewUrl = documentsApi.attachmentPreviewUrl(id, a.id);
                    return (
                      <li key={a.id} className="rounded overflow-hidden"
                        style={{ border: "1px solid var(--border)" }}>
                        <div className="flex items-center justify-between text-xs px-3 py-2"
                          style={{ background: "var(--bg-elevated)" }}>
                          <div className="flex items-center gap-2 min-w-0">
                            {isLink ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="2" strokeLinecap="round" aria-hidden="true"
                                style={{ color: "var(--primary)", flexShrink: 0 }}>
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                              </svg>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="2" strokeLinecap="round" aria-hidden="true"
                                style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                              </svg>
                            )}
                            {isLink ? (
                              <a href={a.link_url!} target="_blank" rel="noopener noreferrer"
                                className="truncate hover:underline" style={{ color: "var(--primary)" }}>
                                {a.display_name || a.filename}
                              </a>
                            ) : (
                              <span className="truncate" style={{ color: "var(--text-primary)" }}>{a.display_name || a.filename}</span>
                            )}
                            {!isLink && a.file_size != null && (
                              <span className="flex-shrink-0" style={{ color: "var(--text-muted)" }}>{fmtSize(a.file_size)}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            {!isLink && (
                              <a href={fileUrl}
                                className="hover:underline" style={{ color: "var(--primary)" }}>下載</a>
                            )}
                            {isDraft && (
                              <button
                                onClick={() => {
                                  setEditingAttachmentId(a.id);
                                  setEditingAttachmentName(a.display_name || a.filename);
                                }}
                                className="transition-colors hover:opacity-80"
                                style={{ color: "var(--text-muted)" }}>
                                改名
                              </button>
                            )}
                            {isDraft && (
                              <button onClick={() => deleteAttachment(a.id)}
                                className="transition-colors hover:text-red-500"
                                style={{ color: "var(--text-muted)" }}>刪除</button>
                            )}
                          </div>
                        </div>
                        {isImg && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={previewUrl} alt={a.display_name || a.filename}
                            className="w-full object-contain"
                            style={{
                              maxHeight: doc.attachments.length <= 2 ? "520px" : "320px",
                              background: "var(--bg-surface)",
                            }} />
                        )}
                        {isPdf && (
                          <object data={previewUrl} type="application/pdf"
                            className="w-full" style={{ height: "420px", display: "block" }}>
                            <p className="text-xs p-3" style={{ color: "var(--text-muted)" }}>
                              瀏覽器不支援 PDF 預覽，請
                              <a href={fileUrl} target="_blank" rel="noopener noreferrer"
                                style={{ color: "var(--primary)" }}>下載查看</a>。
                            </p>
                          </object>
                        )}
                        {isDraft && editingAttachmentId === a.id && (
                          <div className="px-3 py-2 flex items-center gap-2" style={{ borderTop: "1px solid var(--border)" }}>
                            <input
                              value={editingAttachmentName}
                              onChange={e => setEditingAttachmentName(e.target.value)}
                              className="flex-1 text-xs outline-none rounded px-2 py-1.5"
                              style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                            />
                            <button onClick={() => setEditingAttachmentId(null)} className="text-xs px-2 py-1 rounded"
                              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                              取消
                            </button>
                            <button onClick={() => renameAttachment(a.id)} className="text-xs px-2 py-1 rounded"
                              style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                              儲存
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {doc.attachments.length > 3 && (
                  <div className="mt-3 flex justify-center">
                    <button
                      onClick={() => setShowAllAttachments(v => !v)}
                      className="text-xs px-3 py-1.5 rounded transition-opacity hover:opacity-80"
                      style={{ color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}>
                      {showAllAttachments ? "收合附件" : `顯示全部附件（${doc.attachments.length}）`}
                    </button>
                  </div>
                )}
                </>
              )}
            {/* 草稿模式：新增連結附件 */}
            {isDraft && (
              <div className="mt-3 pt-3 flex flex-wrap gap-2" style={{ borderTop: "1px dashed var(--border)" }}>
                <input placeholder="連結網址 https://…" value={newLinkUrl}
                  onChange={e => setNewLinkUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addLink(); }}
                  className="text-xs outline-none rounded px-2 py-1.5 flex-[2] min-w-32"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                <input placeholder="顯示名稱（選填）" value={newLinkText}
                  onChange={e => setNewLinkText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addLink(); }}
                  className="text-xs outline-none rounded px-2 py-1.5 flex-1 min-w-24"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                <button onClick={addLink} disabled={addingLink || !newLinkUrl.trim()}
                  className="text-xs px-3 py-1.5 rounded transition-opacity hover:opacity-80 disabled:opacity-40 flex-shrink-0"
                  style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                  {addingLink ? "新增中…" : "＋ 新增連結"}
                </button>
              </div>
            )}
          </div>
          )}

          {/* PDF / Google Drive 預覽 */}
          {showAttachments && (() => {
            const previews: Array<{ key: string; label: string; src: string }> = [];

            // Google Drive 連結
            doc.attachments
              .filter(a => {
                if (!a.link_url) return false;
                const m = a.link_url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
                return Boolean(m);
              })
              .slice(0, 2)
              .forEach(a => {
                const m = a.link_url!.match(/drive\.google\.com\/file\/d\/([^/]+)/);
                if (m) {
                  previews.push({
                    key: `gdrive-${a.id}`,
                    label: `Google Drive 預覽：${a.filename}`,
                    src: `https://drive.google.com/file/d/${m[1]}/preview`,
                  });
                }
              });

            return previews.map(p => (
              <div key={p.key} className="card p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3"
                  style={{ color: "var(--text-muted)" }}>
                  {p.label}
                </h3>
                <iframe
                  src={p.src}
                  title={p.label}
                  className="w-full rounded"
                  style={{ height: "600px", border: "1px solid var(--border)" }}
                  sandbox="allow-same-origin allow-scripts allow-popups"
                  referrerPolicy="no-referrer"
                  allow="fullscreen"
                />
              </div>
            ));
          })()}

          {/* 版本歷程 */}
          {showVersions && <VersionHistory revisions={doc.revisions} />}
        </div>

        {/* 右：審核面板 */}
        <div className="space-y-4">
          {doc.approvals.length > 0
            ? <ApprovalPanel
                steps={doc.approvals}
                canApprove={canApprove}
                currentUserId={currentUserId}
                allUsers={allUsers}
                onApprove={handleApprove}
                onReject={handleReject}
                onSetDelegate={handleSetDelegate}
              />
            : (
              <div className="card p-4 text-xs text-center space-y-2">
                <p style={{ color: "var(--text-muted)" }}>尚未設定審核人</p>
                {isDraft && (
                  <button onClick={() => setSubmitMode(true)}
                    className="text-xs px-3 py-1.5 rounded"
                    style={{ color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}>
                    設定並送審
                  </button>
                )}
              </div>
            )
          }
        </div>
      </div>
    </div>
    </>
  );
}
