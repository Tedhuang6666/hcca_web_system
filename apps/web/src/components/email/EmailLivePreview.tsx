import type { RecipientRow } from "@/app/(protected)/email/emailComposeConfig";

export function EmailLivePreview({
  recipientRows,
  previewRecipientIndex,
  onPreviewRecipientChange,
  sanitizedPreviewHtml,
  previewHtml,
  previewError,
  subject,
}: {
  recipientRows: RecipientRow[];
  previewRecipientIndex: number;
  onPreviewRecipientChange: (index: number) => void;
  sanitizedPreviewHtml: string;
  previewHtml: string;
  previewError: string;
  subject: string;
}) {
  return (
          <section className="card overflow-hidden p-0">
            <div
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <span className="text-sm font-semibold">信件預覽</span>
              {recipientRows.length > 0 && (
                <select
                  className="input max-w-64 py-1 text-xs"
                  value={Math.min(previewRecipientIndex, recipientRows.length - 1)}
                  onChange={(e) => onPreviewRecipientChange(Number(e.target.value))}
                  aria-label="選擇預覽收件人"
                >
                  {recipientRows.map((row, index) => (
                    <option key={`${row.email}-${index}`} value={index}>
                      {row.name || row.email || `第 ${index + 1} 列`}
                      {row.name && row.email ? `（${row.email}）` : row.userId ? "（平台帳號）" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {previewHtml ? (
              <iframe
                title="信件預覽"
                srcDoc={sanitizedPreviewHtml}
                sandbox=""
                className="h-[520px] w-full"
                style={{ background: "#fff" }}
              />
            ) : (
              <div
                role={previewError ? "alert" : "status"}
                className="flex h-[520px] items-center justify-center text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                {previewError || (subject.trim() ? "正在產生預覽…" : "填寫主旨後即可預覽")}
              </div>
            )}
          </section>

  );
}
