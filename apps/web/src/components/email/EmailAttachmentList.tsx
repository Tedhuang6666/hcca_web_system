import type { EmailAttachmentOut } from "@/lib/types";

export function EmailAttachmentList({
  attachments,
  onRemove,
}: {
  attachments: EmailAttachmentOut[];
  onRemove: (attachment: EmailAttachmentOut) => void;
}) {
  return (
    <>
            {attachments.map((attachment) => (
              <div key={attachment.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border)" }}>
                <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {(attachment.file_size / 1024 / 1024).toFixed(2)} MB ·
                  {attachment.delivery_mode === "attachment" ? " 實體附件" : " 安全連結"}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove(attachment)}>移除</button>
              </div>
            ))}
    </>
  );
}
