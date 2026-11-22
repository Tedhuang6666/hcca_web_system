"use client";

import { useEffect, useState } from "react";
import type { PetitionAttachmentOut } from "@/lib/types";
import { ApiError, authFetch, petitionsApi } from "@/lib/api";
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";

function formatSize(size: number | null) {
  if (size == null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function PetitionAttachmentRow({
  caseId,
  attachment,
  showVisibility,
}: {
  caseId: string;
  attachment: PetitionAttachmentOut;
  showVisibility: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [loading, setLoading] = useState(false);
  const filename = attachment.display_name || attachment.filename;
  const isImage = attachment.content_type?.startsWith("image/") ?? false;

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setLoading(true);
    setPreviewError("");
    setPreviewUrl(null);

    authFetch(petitionsApi.attachmentPreviewUrl(caseId, attachment.id), {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          let message = `附件預覽失敗（HTTP ${response.status}）`;
          try {
            const data = await response.json() as { detail?: string };
            if (data.detail) message = data.detail;
          } catch {
            // Keep the HTTP status message when the response is not JSON.
          }
          throw new ApiError(response.status, message);
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setPreviewType(blob.type || attachment.content_type || "application/octet-stream");
        setPreviewUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPreviewError(error instanceof Error ? error.message : "無法預覽此附件");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.content_type, attachment.id, caseId, isOpen]);

  return (
    <article className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="break-all text-sm font-medium" style={{ color: "var(--text-primary)" }}>{filename}</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {formatSize(attachment.file_size)}
            {showVisibility && ` · ${attachment.visibility === "internal" ? "僅內部可見" : "陳情人可見"}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost min-h-9 px-3 text-sm"
            aria-expanded={isOpen}
            onClick={() => setIsOpen((value) => !value)}
          >
            {isOpen ? "收起附件" : "查看附件"}
          </button>
          <AnimatedDownloadButton
            className="btn btn-ghost min-h-9 px-3 text-sm"
            href={petitionsApi.attachmentDownloadUrl(caseId, attachment.id)}
            filename={filename}
            label="下載"
          />
        </div>
      </div>
      {isOpen && (
        <div className="border-t p-3" style={{ borderColor: "var(--border)", background: "var(--bg-hover)" }}>
          {loading ? (
            <p className="p-6 text-center text-sm" style={{ color: "var(--text-muted)" }} aria-live="polite">
              正在準備查看附件…
            </p>
          ) : previewError ? (
            <p className="p-4 text-sm" role="alert" style={{ color: "var(--danger)" }}>{previewError}</p>
          ) : previewUrl && isImage && previewType.startsWith("image/") ? (
            // The API only serves raster formats accepted by the attachment whitelist.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={filename}
              className="mx-auto max-h-[70vh] max-w-full rounded object-contain"
            />
          ) : previewUrl ? (
            <iframe
              src={previewUrl}
              title={`預覽附件：${filename}`}
              className="h-[70vh] min-h-96 w-full rounded bg-white"
              referrerPolicy="no-referrer"
            />
          ) : null}
        </div>
      )}
    </article>
  );
}

export default function PetitionAttachmentList({
  caseId,
  attachments,
  showVisibility = false,
}: {
  caseId: string;
  attachments: PetitionAttachmentOut[];
  showVisibility?: boolean;
}) {
  if (attachments.length === 0) {
    return <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無附件</p>;
  }

  return (
    <div className="space-y-2">
      {attachments.map((attachment) => (
        <PetitionAttachmentRow
          key={attachment.id}
          caseId={caseId}
          attachment={attachment}
          showVisibility={showVisibility}
        />
      ))}
    </div>
  );
}
