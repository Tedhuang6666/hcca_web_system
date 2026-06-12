"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  Download,
  ExternalLink,
  File,
  FileImage,
  FilePlus2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { governanceApi } from "@/lib/api";
import type {
  PlanningDocumentAttachmentOut,
  PlanningDocumentOut,
} from "@/lib/types";

type MobileTab = "content" | "versions" | "attachments";

export default function PlanningDocumentsPanel({
  documents,
  onChange,
}: {
  documents: PlanningDocumentOut[];
  onChange: (documents: PlanningDocumentOut[]) => void;
}) {
  return (
    <div className="space-y-3">
      {documents.map((document) => (
        <PlanningDocumentCard
          key={document.id}
          document={document}
          onChange={(updated) =>
            onChange(documents.map((item) => (item.id === updated.id ? updated : item)))
          }
        />
      ))}
      {documents.length === 0 && (
        <div className="rounded-lg p-6 text-center text-sm" style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}>
          尚無企劃書
        </div>
      )}
    </div>
  );
}

function PlanningDocumentCard({
  document,
  onChange,
}: {
  document: PlanningDocumentOut;
  onChange: (document: PlanningDocumentOut) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<MobileTab>("content");
  const [uploading, setUploading] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState(`第 ${document.current_version + 1} 版`);
  const [versionContent, setVersionContent] = useState(
    document.revisions.at(-1)?.content ?? "",
  );
  const [changeReason, setChangeReason] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>(
    document.revisions.at(-1)?.attachment_links.map((item) => item.attachment_id) ?? [],
  );
  const [primaryId, setPrimaryId] = useState<string | null>(
    document.revisions.at(-1)?.attachment_links.find((item) => item.is_primary)
      ?.attachment_id ?? null,
  );

  const latest = document.revisions.at(-1);
  const primary = useMemo(
    () =>
      latest?.attachment_links.find((item) => item.is_primary)?.attachment ??
      latest?.attachment_links[0]?.attachment ??
      document.attachments[0],
    [document.attachments, latest],
  );

  const refresh = async () => {
    const matter = await governanceApi.getMatter(document.matter_id);
    const updated = matter.planning_documents.find((item) => item.id === document.id);
    if (updated) onChange(updated);
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const attachment = await governanceApi.uploadPlanningAttachment(document.id, file);
      onChange({ ...document, attachments: [...document.attachments, attachment] });
      setSelectedIds((ids) => [...ids, attachment.id]);
      setPrimaryId((id) => id ?? attachment.id);
      toast.success("附件已上傳，可在新版本中引用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "附件上傳失敗");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (attachment: PlanningDocumentAttachmentOut) => {
    try {
      await governanceApi.deletePlanningAttachment(document.id, attachment.id);
      onChange({
        ...document,
        attachments: document.attachments.filter((item) => item.id !== attachment.id),
      });
      setSelectedIds((ids) => ids.filter((id) => id !== attachment.id));
      toast.success("附件已刪除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "附件刪除失敗");
    }
  };

  const rename = async (attachment: PlanningDocumentAttachmentOut) => {
    const nextName = window.prompt(
      "附件顯示名稱",
      attachment.display_name || attachment.filename,
    )?.trim();
    if (!nextName) return;
    try {
      const updated = await governanceApi.renamePlanningAttachment(
        document.id,
        attachment.id,
        nextName,
      );
      onChange({
        ...document,
        attachments: document.attachments.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      });
      toast.success("附件名稱已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "附件改名失敗");
    }
  };

  const createVersion = async () => {
    try {
      await governanceApi.createPlanningRevision(document.id, {
        version_label: versionLabel.trim(),
        content: versionContent.trim(),
        change_reason: changeReason.trim() || null,
        attachment_ids: selectedIds,
        primary_attachment_id: primaryId,
      });
      await refresh();
      setVersionOpen(false);
      setChangeReason("");
      toast.success("新版本已建立");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立版本失敗");
    }
  };

  return (
    <article className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--bg-hover)" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-14 w-full items-center justify-between gap-3 p-3 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{document.title}</span>
          <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>
            {document.status} · v{document.current_version} · {document.attachments.length} 個附件
          </span>
        </span>
        <ChevronDown size={16} className={`flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t p-3" style={{ borderColor: "var(--border)" }}>
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg p-1 lg:hidden" style={{ background: "var(--bg-surface)" }}>
            {(["content", "versions", "attachments"] as MobileTab[]).map((key) => (
              <button
                key={key}
                type="button"
                className="min-h-10 rounded-md text-xs font-medium"
                style={{
                  background: tab === key ? "var(--primary-dim)" : "transparent",
                  color: tab === key ? "var(--primary)" : "var(--text-muted)",
                }}
                onClick={() => setTab(key)}
              >
                {{ content: "內容", versions: "版本", attachments: "附件" }[key]}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <section className={`${tab === "content" ? "block" : "hidden"} lg:block`}>
              <DocumentPreview documentId={document.id} attachment={primary} />
              {latest?.content && (
                <p className="mt-3 whitespace-pre-wrap text-sm" style={{ color: "var(--text-secondary)" }}>
                  {latest.content}
                </p>
              )}
            </section>

            <div className="space-y-4">
              <section className={`${tab === "versions" ? "block" : "hidden"} lg:block`}>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">版本歷程</h4>
                  <button type="button" className="btn btn-secondary min-h-10 text-xs" onClick={() => setVersionOpen((value) => !value)}>
                    <Plus size={13} /> 新版本
                  </button>
                </div>
                {versionOpen && (
                  <div className="mb-3 space-y-2 rounded-lg p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                    <label className="block text-xs">
                      版本名稱
                      <input className="input mt-1 min-h-10 w-full" value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} />
                    </label>
                    <label className="block text-xs">
                      修訂內容
                      <textarea className="input mt-1 min-h-24 w-full" value={versionContent} onChange={(event) => setVersionContent(event.target.value)} />
                    </label>
                    <label className="block text-xs">
                      修訂原因
                      <input className="input mt-1 min-h-10 w-full" value={changeReason} onChange={(event) => setChangeReason(event.target.value)} />
                    </label>
                    {document.attachments.length > 0 && (
                      <fieldset>
                        <legend className="mb-1 text-xs">引用附件與主要文件</legend>
                        <div className="space-y-1">
                          {document.attachments.map((attachment) => (
                            <label key={attachment.id} className="flex min-h-10 items-center gap-2 rounded px-2 text-xs" style={{ border: "1px solid var(--border)" }}>
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(attachment.id)}
                                onChange={(event) => {
                                  setSelectedIds((ids) =>
                                    event.target.checked
                                      ? [...ids, attachment.id]
                                      : ids.filter((id) => id !== attachment.id),
                                  );
                                  if (!event.target.checked && primaryId === attachment.id) setPrimaryId(null);
                                }}
                              />
                              <span className="min-w-0 flex-1 truncate">{attachment.display_name || attachment.filename}</span>
                              <input
                                type="radio"
                                name={`primary-${document.id}`}
                                aria-label="設為主要文件"
                                checked={primaryId === attachment.id}
                                disabled={!selectedIds.includes(attachment.id)}
                                onChange={() => setPrimaryId(attachment.id)}
                              />
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                    <button type="button" className="btn btn-primary min-h-10 w-full" disabled={!versionLabel.trim() || !versionContent.trim()} onClick={() => void createVersion()}>
                      建立版本
                    </button>
                  </div>
                )}
                <div className="space-y-2">
                  {[...document.revisions].reverse().map((revision) => (
                    <div key={revision.id} className="rounded-lg p-3 text-xs" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                      <div className="flex justify-between gap-2">
                        <strong>v{revision.version_number} · {revision.version_label}</strong>
                        <span style={{ color: "var(--text-muted)" }}>{new Date(revision.created_at).toLocaleDateString("zh-TW")}</span>
                      </div>
                      {revision.change_reason && <p className="mt-1" style={{ color: "var(--text-muted)" }}>{revision.change_reason}</p>}
                      {revision.attachment_links.length > 0 && (
                        <p className="mt-1" style={{ color: "var(--text-muted)" }}>
                          附件 {revision.attachment_links.length} 個
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className={`${tab === "attachments" ? "block" : "hidden"} lg:block`}>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">共用附件</h4>
                  <label className="btn btn-secondary min-h-10 cursor-pointer text-xs">
                    <input
                      type="file"
                      className="hidden"
                      disabled={uploading}
                      accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void upload(file);
                        event.target.value = "";
                      }}
                    />
                    {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    上傳
                  </label>
                </div>
                <div className="space-y-2">
                  {document.attachments.map((attachment) => (
                    <div key={attachment.id} className="flex min-h-12 items-center gap-2 rounded-lg p-2" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                      {attachment.content_type.startsWith("image/") ? <FileImage size={15} /> : <File size={15} />}
                      <span className="min-w-0 flex-1 truncate text-xs">{attachment.display_name || attachment.filename}</span>
                      <a href={governanceApi.planningAttachmentDownloadUrl(document.id, attachment.id)} className="topbar-icon-btn" aria-label="下載">
                        <Download size={13} />
                      </a>
                      <button type="button" className="topbar-icon-btn" aria-label="改名" onClick={() => void rename(attachment)}>
                        <Pencil size={13} />
                      </button>
                      <button type="button" className="topbar-icon-btn" aria-label="刪除" onClick={() => void remove(attachment)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {document.attachments.length === 0 && (
                    <p className="rounded-lg p-4 text-center text-xs" style={{ color: "var(--text-muted)", background: "var(--bg-surface)" }}>
                      尚無附件
                    </p>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function DocumentPreview({
  documentId,
  attachment,
}: {
  documentId: string;
  attachment?: PlanningDocumentAttachmentOut;
}) {
  if (!attachment) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-lg text-sm" style={{ background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px dashed var(--border)" }}>
        <FilePlus2 size={18} className="mr-2" /> 尚未指定主要文件
      </div>
    );
  }
  const previewUrl = governanceApi.planningAttachmentPreviewUrl(documentId, attachment.id);
  const downloadUrl = governanceApi.planningAttachmentDownloadUrl(documentId, attachment.id);
  const image = attachment.content_type.startsWith("image/");
  const pdf = attachment.content_type === "application/pdf";

  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={previewUrl} alt={attachment.display_name || attachment.filename} className="max-h-[560px] w-full rounded-lg object-contain" style={{ background: "var(--bg-surface)" }} />;
  }
  if (pdf) {
    return (
      <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)" }}>
        <object data={previewUrl} type="application/pdf" className="hidden h-[520px] w-full sm:block">
          <a href={downloadUrl}>下載 PDF</a>
        </object>
        <div className="flex min-h-32 items-center justify-center gap-2 p-4 sm:hidden">
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary min-h-11">
            <ExternalLink size={14} /> 開啟 PDF
          </a>
          <a href={downloadUrl} className="btn btn-secondary min-h-11">
            <Download size={14} /> 下載
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <p className="text-sm font-medium">{attachment.display_name || attachment.filename}</p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>此 Office 文件不支援瀏覽器內嵌預覽。</p>
      <a href={downloadUrl} className="btn btn-secondary mt-3 min-h-11">
        <Download size={14} /> 下載文件
      </a>
    </div>
  );
}
