"use client";
import { useState, useEffect, useCallback } from "react";
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
import { useWS } from "@/hooks/useWS";

function toROCDate(dateStr: string) {
  const d = new Date(dateStr);
  const y = d.getFullYear() - 1911;
  return `中華民國 ${y} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

const CAT_LABEL: Record<string, string> = {
  letter: "函", decree: "令", announcement: "公告", report: "報告",
  meeting_notice: "開會通知單", other: "其他",
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

function UserPicker({
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

  const filtered = users.filter(u =>
    u.display_name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()),
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
}

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
  const [zoom, setZoom] = useState(100);
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

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const handleShare = async () => {
    const shareData = { title: doc?.title ?? "公文", url: window.location.href };
    if (typeof navigator.share === "function") {
      try { await navigator.share(shareData); return; } catch {}
    }
    try { await navigator.clipboard.writeText(window.location.href); toast.success("連結已複製到剪貼簿"); }
    catch { toast.error("複製失敗"); }
  };

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkText, setNewLinkText] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [editingAttachmentId, setEditingAttachmentId] = useState<string | null>(null);
  const [editingAttachmentName, setEditingAttachmentName] = useState("");
  const [showAllAttachments, setShowAllAttachments] = useState(false);
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

  return (
    <>
    <div className="max-w-5xl mx-auto space-y-5">
      {/* 麵包屑 */}
      <Breadcrumb items={[
        { label: "公文系統", href: "/documents" },
        { label: doc.serial_number ?? doc.title },
      ]} />
      {/* 頂部 */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link href="/documents"
            className="w-8 h-8 rounded-lg flex items-center justify-center  hover:"
            style={{ border: "1px solid var(--border)" }}>←</Link>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-sm font-mono" style={{ color: "var(--primary)" }}>{doc.serial_number}</span>
              <DocumentStatusBadge status={doc.status} />
              <UrgencyBadge urgency={doc.urgency} />
            </div>
            <h1 className="text-xl font-semibold ">{doc.title}</h1>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap justify-end">
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
          {/* 分享 */}
          <button onClick={handleShare}
            className="px-3 py-2 rounded-lg text-sm inline-flex items-center gap-1.5 transition-colors hover:opacity-80"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
            title="分享">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            分享
          </button>

          {/* 全螢幕 */}
          <button onClick={handleFullscreen}
            className="px-2.5 py-2 rounded-lg text-sm transition-colors hover:opacity-80"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
            title={isFullscreen ? "退出全螢幕" : "全螢幕"}>
            {isFullscreen ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
            )}
          </button>

          {/* 官式公文列印（後端格式，帶 token 避免 401） */}
          <button
            onClick={async () => {
              if (printingPdf) return;
              const toastId = toast.loading("正在處理檔案，請稍候...");
              setPrintingPdf(true);
              try {
                const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
                const res = await fetch(`${BASE}/documents/${id}/print`, {
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
          {/* 元資料 */}
          <div className="card p-4">
            <dl className="grid grid-cols-2 gap-3 text-xs">
              {([
                ["字號", doc.serial_number],
                ["類別", catLabel],
                ["密等", { normal: "普通", confidential: "機密", secret: "秘密" }[doc.classification] ?? doc.classification],
                ["建立日期", new Date(doc.created_at).toLocaleDateString("zh-TW")],
                ["送審日期", doc.submitted_at ? new Date(doc.submitted_at).toLocaleDateString("zh-TW") : "—"],
                ["限辦日期", doc.due_date ? new Date(doc.due_date).toLocaleDateString("zh-TW") : "—"],
                ["承辦人", doc.handler_name
                  ? `${doc.handler_name}${doc.handler_unit ? ` / ${doc.handler_unit}` : ""}`
                  : "—"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k}>
                  <dt style={{ color: "var(--text-muted)" }}>{k}</dt>
                  <dd className="mt-0.5 ">{v}</dd>
                </div>
              ))}
            </dl>
            {doc.handler_phone && (
              <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                聯絡：{doc.handler_phone}
                {doc.handler_email && <span> · {doc.handler_email}</span>}
              </p>
            )}
          </div>

          {/* 受文者 */}
          {doc.recipients.length > 0 && (
            <div className="card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>受文者</h3>
              <div className="flex flex-wrap gap-2">
                {doc.recipients.map(r => (
                  <span key={r.id} className="text-xs px-2.5 py-1 rounded-full"
                    style={{ color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}>
                    {{ main: "受文者", primary: "正本", copy: "副本" }[r.recipient_type]} {r.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 公文本文（官式橫書格式） */}
          <div className="card overflow-hidden" style={{ fontSize: `${zoom}%` }}>
            <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>公文內容</span>
            </div>

            {/* 官式公文標頭區塊 */}
            <div className="px-6 pt-5 pb-3" style={{
              fontFamily: '"標楷體", "DFKai-SB", serif',
              borderBottom: "1px solid var(--border)",
            }}>
              {/* 公文字號 + 發文日期 */}
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--text-secondary)" }}>
                  公文字號：
                  <span className="font-mono font-semibold" style={{ color: "var(--primary)" }}>
                    {doc.serial_number || "（未分配）"}
                  </span>
                </span>
                <span style={{ color: "var(--text-secondary)" }}>
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
              {doc.category !== "announcement" && doc.recipients.filter(r => r.recipient_type === "main" || r.recipient_type === "primary").length > 0 && (
                <div className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                  受文者：{doc.recipients.filter(r => r.recipient_type === "main" || r.recipient_type === "primary").map(r => r.name).join("、")}
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
                      <p style={{ color: "var(--text-primary)" }}>說明：</p>
                      <div className="pl-[2em]" style={{ color: "var(--text-primary)" }}>
                        <OfficialText value={doc.doc_description} />
                      </div>
                    </div>
                  )}
                  {doc.action_required && (
                    <div>
                      <p style={{ color: "var(--text-primary)" }}>辦法：</p>
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

              {/* 簽署區（核准後顯示） — 右下角顯示「機關首長 姓名」 */}
              {(doc.status === "approved" || doc.status === "archived") && (
                <div className="mt-8 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
                  <div className="flex justify-end">
                    <div className="text-right space-y-2">
                      {(() => {
                        const approved = doc.approvals
                          .filter(a => a.status === "approved")
                          .sort((a, b) => b.step_order - a.step_order);
                        const step = approved[0];
                        const signature = formatActingSignature(step);
                        if (signature) {
                          return (
                            <>
                              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                                {signature.title}
                              </p>
                              <p className="text-3xl tracking-[0.15em]"
                                style={{
                                  color: "var(--primary)",
                                  fontFamily: '"Segoe Print","Bradley Hand ITC","HanziPen SC","Yuji Syuku","DFKai-SB","標楷體",cursive',
                                }}>
                                {signature.name}
                              </p>
                              <p className="text-xs" style={{ color: "var(--text-muted)" }}>（蓋章處）</p>
                            </>
                          );
                        }
                        // 無簽核人時，以 handler_unit/handler_name 作為簽署資訊（如主席公布令）
                        if (doc.handler_name) {
                          return (
                            <>
                              {doc.handler_unit && (
                                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{doc.handler_unit}</p>
                              )}
                              <p className="text-3xl tracking-[0.15em]"
                                style={{
                                  color: "var(--primary)",
                                  fontFamily: '"Segoe Print","Bradley Hand ITC","HanziPen SC","Yuji Syuku","DFKai-SB","標楷體",cursive',
                                }}>
                                {doc.handler_name}
                              </p>
                              <p className="text-xs" style={{ color: "var(--text-muted)" }}>（蓋章處）</p>
                            </>
                          );
                        }
                        return <p className="text-xs" style={{ color: "var(--text-muted)" }}>（蓋章處）</p>;
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 附件 */}
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

          {/* PDF / Google Drive 預覽 */}
          {(() => {
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
          <VersionHistory revisions={doc.revisions} />
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
