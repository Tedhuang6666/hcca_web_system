import Link from "next/link";

import { DocumentStatusBadge, UrgencyBadge } from "@/components/ui/StatusBadge";
import { OfficialText } from "@/components/ui/OfficialText";
import type { DocumentOut } from "@/lib/types";

const CATEGORY_LABEL: Record<string, string> = {
  letter: "函",
  decree: "令",
  announcement: "公告",
  presentation: "呈",
  report: "報告",
  record: "紀錄",
  consultation: "咨",
  meeting_notice: "開會通知單",
  inspection_notice: "會勘通知單",
  phone_record: "公務電話紀錄",
  book_letter: "書函",
  directive: "手令",
  signature: "簽",
  memo: "便簽",
  appointment: "聘書",
  certificate: "證明書",
  license: "證書／執照",
  contract: "契約書",
  proposal: "提案",
  summary: "節略",
  briefing: "說帖",
  form: "定型化表單",
  other: "其他",
};

const CLASSIFICATION_LABEL: Record<string, string> = {
  normal: "普通",
  confidential: "密",
  secret: "機密",
  highly_confidential: "極機密",
  absolutely_confidential: "絕對機密",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("zh-TW");
}

function formatRocDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return `中華民國 ${date.getFullYear() - 1911} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function formatSignature(document: DocumentOut) {
  const approved = document.approvals
    .filter((step) => step.status === "approved")
    .sort((a, b) => b.step_order - a.step_order)[0];
  const name = approved?.approver.name || document.issuer_full_name || document.handler_name;
  const title = approved?.approver_title || document.handler_unit;
  return { name, title };
}

function DocumentBody({ document }: { document: DocumentOut }) {
  const decreeBody = document.doc_description
    || document.content
    || document.action_required
    || document.subject;
  const attachments = document.attachments
    .map((attachment) => attachment.display_name || attachment.filename)
    .filter(Boolean)
    .join("、");

  if (document.category === "decree") {
    return (
      <div className="space-y-5" style={{ color: "var(--text-primary)" }}>
        {decreeBody && <OfficialText value={decreeBody} className="text-sm" />}
        {attachments && (
          <div>
            <p>附件：</p>
            <div className="pl-[2em]"><OfficialText value={attachments} /></div>
          </div>
        )}
      </div>
    );
  }

  if (document.category === "meeting_notice" || document.category === "record") {
    return (
      <div className="space-y-3 text-sm" style={{ color: "var(--text-primary)" }}>
        {document.meeting_time && (
          <div className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-2">
            <span>時間：</span><span>{formatRocDate(document.meeting_time)}</span>
          </div>
        )}
        {document.meeting_location && (
          <div className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-2">
            <span>{document.category === "record" ? "地點：" : "開會地點："}</span>
            <span className="break-words">{document.meeting_location}</span>
          </div>
        )}
        {document.meeting_chairperson && (
          <div className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-2">
            <span>{document.category === "record" ? "主席：" : "主持人："}</span>
            <span className="break-words">{document.meeting_chairperson}</span>
          </div>
        )}
        {document.handler_name && document.category === "record" && (
          <div className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-2">
            <span>記錄者：</span><span>{document.handler_name}</span>
          </div>
        )}
        {document.doc_description && (
          <div>
            <p className="mb-1">{document.category === "record" ? "討論事項：" : "議事日程："}</p>
            <div className="pl-[2em]"><OfficialText value={document.doc_description} /></div>
          </div>
        )}
        {document.action_required && document.category === "record" && (
          <div>
            <p className="mb-1">決議：</p>
            <div className="pl-[2em]"><OfficialText value={document.action_required} /></div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 text-sm" style={{ color: "var(--text-primary)" }}>
      {document.subject && (
        <div>
          <p>主旨：</p>
          <div className="pl-[2em]"><OfficialText value={document.subject} /></div>
        </div>
      )}
      {document.doc_description && (
        <div>
          <p>
            {document.category === "announcement"
              ? "公告事項："
              : document.category === "report"
                ? "說明／分析："
                : "說明："}
          </p>
          <div className="pl-[2em]"><OfficialText value={document.doc_description} /></div>
        </div>
      )}
      {document.action_required && (
        <div>
          <p>
            {document.category === "report"
              ? "建議事項："
              : document.category === "consultation"
                ? "辦法或事項："
                : "辦法："}
          </p>
          <div className="pl-[2em]"><OfficialText value={document.action_required} /></div>
        </div>
      )}
      {!document.subject && !document.doc_description && !document.action_required && document.content && (
        <OfficialText value={document.content} className="text-sm" />
      )}
    </div>
  );
}

export default function PublicDocumentView({ document }: { document: DocumentOut | null }) {
  if (!document) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6" role="status">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          公文不存在，或目前不對外公開。
        </p>
      </div>
    );
  }

  const signature = formatSignature(document);
  const issuedDate = formatRocDate(document.issued_at);
  const isDecree = document.category === "decree";

  return (
    <div className="app-page-width space-y-5" aria-labelledby="public-document-title">
      <nav aria-label="目前位置" className="text-xs" style={{ color: "var(--text-muted)" }}>
        <Link href="/documents" className="hover:underline">公文</Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span>{document.serial_number || document.title}</span>
      </nav>

      <header className="document-detail-heading flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Link
            href="/documents"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ border: "1px solid var(--border)" }}
            aria-label="返回公文列表"
          >
            ←
          </Link>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <span className="break-all font-mono text-sm" style={{ color: "var(--primary)" }}>
                {document.serial_number}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <DocumentStatusBadge status={document.status} />
                <UrgencyBadge urgency={document.urgency} />
              </div>
            </div>
            <h1
              id="public-document-title"
              className="document-detail-title break-words text-lg font-semibold leading-snug sm:text-xl"
            >
              {document.title}
            </h1>
            {document.summary && (
              <p className="mt-1 break-words text-sm" style={{ color: "var(--text-muted)" }}>
                摘要：{document.summary}
              </p>
            )}
          </div>
        </div>
      </header>

      {document.regulation_id && (
        <section className="card flex flex-wrap items-center gap-2 px-4 py-3 text-sm" aria-label="法規關聯">
          <span style={{ color: "var(--text-muted)" }}>法規關聯：</span>
          <Link href={"/regulations/" + document.regulation_id} className="font-medium hover:underline" style={{ color: "var(--primary)" }}>
            查看對應法規與沿革 →
          </Link>
        </section>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <article className="space-y-4 lg:col-span-2">
          <section className="card overflow-hidden" aria-labelledby="public-document-content-title">
            <div
              className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
              style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}
            >
              <h2 id="public-document-content-title" className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                公文內容
              </h2>
              <span className="font-mono text-xs" style={{ color: "var(--primary)" }}>
                {document.serial_number || "未分配字號"}
              </span>
            </div>
            <div className="space-y-6 px-5 py-6 sm:px-8 sm:py-8">
              <DocumentBody document={document} />
              {(document.status === "approved" || document.status === "archived") && signature.name && (
                <div className="mt-8 border-t pt-6" style={{ borderColor: "var(--border-strong)" }}>
                  <div className={`flex flex-col ${isDecree ? "items-center text-center" : "items-end text-right"} gap-2`}>
                    {signature.title && (
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{signature.title}</p>
                    )}
                    <p className={`${isDecree ? "text-4xl sm:text-5xl" : "text-3xl"} tracking-[0.15em]`} style={{ color: "var(--primary)" }}>
                      {signature.name}
                    </p>
                    {issuedDate && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{issuedDate}</p>}
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>（蓋章處）</span>
                  </div>
                </div>
              )}
            </div>
          </section>

          {document.attachments.length > 0 && (
            <section className="card p-4" aria-labelledby="public-document-attachments-title">
              <h2 id="public-document-attachments-title" className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                附件（{document.attachments.length}）
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                {document.attachments.map((attachment) => (
                  <li key={attachment.id} className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" style={{ color: "var(--text-muted)" }}>↳</span>
                    {attachment.link_url ? (
                      <a
                        href={attachment.link_url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate hover:underline"
                        style={{ color: "var(--primary)" }}
                      >
                        {attachment.display_name || attachment.filename}
                      </a>
                    ) : (
                      <span className="truncate" style={{ color: "var(--text-secondary)" }}>
                        {attachment.display_name || attachment.filename}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>

        <aside className="card h-fit p-4" aria-labelledby="public-document-info-title">
          <h2 id="public-document-info-title" className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
            文件資訊
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-1">
            <div>
              <dt style={{ color: "var(--text-muted)" }}>類別</dt>
              <dd className="mt-0.5" style={{ color: "var(--text-primary)" }}>{CATEGORY_LABEL[document.category] ?? document.category}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--text-muted)" }}>密等</dt>
              <dd className="mt-0.5" style={{ color: "var(--text-primary)" }}>{CLASSIFICATION_LABEL[document.classification] ?? document.classification}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--text-muted)" }}>發布日期</dt>
              <dd className="mt-0.5" style={{ color: "var(--text-primary)" }}>{formatDate(document.issued_at || document.created_at)}</dd>
            </div>
            {document.handler_unit && (
              <div>
                <dt style={{ color: "var(--text-muted)" }}>發布單位</dt>
                <dd className="mt-0.5" style={{ color: "var(--text-primary)" }}>{document.handler_unit}</dd>
              </div>
            )}
            {document.recipients.length > 0 && (
              <div className="col-span-2 sm:col-span-1">
                <dt style={{ color: "var(--text-muted)" }}>受文者</dt>
                <dd className="mt-0.5 break-words" style={{ color: "var(--text-primary)" }}>
                  {document.recipients.map((recipient) => recipient.name).join("、")}
                </dd>
              </div>
            )}
          </dl>
        </aside>
      </div>
    </div>
  );
}
