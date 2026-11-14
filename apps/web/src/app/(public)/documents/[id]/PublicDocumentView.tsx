"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { OfficialText } from "@/components/ui/OfficialText";
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import { documentsApi } from "@/lib/api/documents";
import { administrativeDate, DOCUMENT_CATEGORIES } from "@/lib/administrative";
import type { DocumentOut } from "@/lib/types";
import { BRANDING } from "@/lib/branding";
import { usePersistedZoom } from "@/hooks/usePersistedZoom";

const CATEGORY_LABEL = DOCUMENT_CATEGORIES;
const CLASSIFICATION_LABEL: Record<string, string> = {
  normal: "普通", confidential: "密", secret: "機密",
  highly_confidential: "極機密", absolutely_confidential: "絕對機密",
};
const URGENCY_LABEL: Record<string, string> = { normal: "普通件", priority: "速件", express: "最速件" };
const formatDate = (value: string | null | undefined) => administrativeDate(value);
const formatRocDate = (value: string | null | undefined) => administrativeDate(value, true);

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
        {document.subject && document.subject !== decreeBody && <div><p>主旨：</p><div className="pl-[2em]"><OfficialText value={document.subject} /></div></div>}
        {document.basis && <div><p>依據：</p><div className="pl-[2em]"><OfficialText value={document.basis} /></div></div>}
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

  if (document.category === "consultation") {
    const recipient = document.recipients
      .filter((item) => item.recipient_type === "main" || item.recipient_type === "primary")
      .map((item) => item.name)
      .join("、");
    return (
      <div className="space-y-5 text-sm leading-8" style={{ color: "var(--text-primary)" }}>
        <p>{recipient || "（未填受文者）"}</p>
        {document.subject && <OfficialText value={document.subject} />}
        {document.doc_description && <OfficialText value={document.doc_description} />}
        {document.action_required && <OfficialText value={document.action_required} />}
        <p className="pt-2">此咨</p>
        <p>{recipient || "（未填受文者）"}</p>
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
      {document.basis && (
        <div>
          <p>依據：</p>
          <div className="pl-[2em]"><OfficialText value={document.basis} /></div>
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

export default function PublicDocumentView({ document, loading = false, loadError = null, onRetry, canDownloadPdf = false, managementAction }: {
  document: DocumentOut | null;
  loading?: boolean;
  loadError?: "not_found" | "unavailable" | null;
  onRetry?: () => void;
  canDownloadPdf?: boolean;
  managementAction?: ReactNode;
}) {
  const { zoom, setZoom, zoomStyle } = usePersistedZoom("hcca:zoom:public-document");
  if (!document) return (
    <div className="administrative-feedback" role={loading ? "status" : "alert"}>
      {loading ? "正在載入公開公文…" : loadError === "not_found"
        ? "公文不存在，或目前不對外公開。" : "暫時無法載入公開公文，請稍後再試。"}
      {loadError === "unavailable" && onRetry && <button type="button" onClick={onRetry}>重新載入</button>}
      {!loading && <Link href="/documents">返回公文查詢</Link>}
    </div>
  );
  const category = CATEGORY_LABEL[document.category] ?? document.category;
  const mainRecipients = document.recipients.filter((recipient) => ["main", "primary"].includes(recipient.recipient_type));
  const copyRecipients = document.recipients.filter((recipient) => recipient.recipient_type === "copy");
  return (
    <div className="administrative-document-reader">
      <nav className="administrative-breadcrumb no-print" aria-label="目前位置">
        <Link href="/documents">公開公文</Link><span aria-hidden="true">/</span><span>{document.serial_number}</span>
      </nav>
      <header className="administrative-document-toolbar no-print">
        <h1>公文檢視</h1>
        <div>
          {managementAction}
          <div className="administrative-document-zoom" role="group" aria-label="公文字級">
            <button type="button" onClick={() => setZoom((value) => value - 10)} disabled={zoom <= 70} aria-label="縮小公文字級">A−</button>
            <span aria-live="polite">{zoom}%</span>
            <button type="button" onClick={() => setZoom((value) => value + 10)} disabled={zoom >= 150} aria-label="放大公文字級">A＋</button>
          </div>
          {canDownloadPdf ? <AnimatedDownloadButton request={() => documentsApi.printPdf(document.id)}
            filename={`${document.serial_number}.pdf`} className="administrative-button" label="下載公文 PDF" />
            : <Link className="administrative-button" href={`/login?next=${encodeURIComponent(`/documents/${encodeURIComponent(document.serial_number)}`)}`}>登入下載 PDF</Link>}
          <button type="button" className="administrative-button" onClick={() => window.print()}><Printer size={16} aria-hidden="true" />列印本文</button>
        </div>
      </header>
      <div className="administrative-document-stage">
        <article className="official-paper" aria-labelledby="public-document-title" style={zoomStyle}>
          <header className="official-paper-header">
            <h2 id="public-document-title">{document.category === "decree" && <>{BRANDING.orgName}<br /></>}{document.issuer_full_name ? `${document.issuer_full_name}　${category}` : category}</h2>
            <dl className="official-paper-meta">
              <dt>發文日期：</dt><dd><time dateTime={document.issued_at ?? undefined}>{formatRocDate(document.issued_at)}</time></dd>
              <dt>發文字號：</dt><dd>{document.serial_number}</dd>
              <dt>速別：</dt><dd>{URGENCY_LABEL[document.urgency] ?? document.urgency}</dd>
              <dt>密等：</dt><dd>{CLASSIFICATION_LABEL[document.classification] ?? document.classification}</dd>
            </dl>
          </header>
          {mainRecipients.length > 0 && document.category !== "consultation" && <p>受文者：{mainRecipients.map((recipient) => recipient.name).join("、")}</p>}
          <div className="official-paper-body"><DocumentBody document={document} /></div>
          {copyRecipients.length > 0 && <dl className="official-paper-recipients"><dt>副本：</dt><dd>{copyRecipients.map((recipient) => recipient.name).join("、")}</dd></dl>}
        </article>
      </div>
      {document.attachments.length > 0 && <section className="administrative-document-supplement no-print" aria-labelledby="public-document-attachments-title">
        <h2 id="public-document-attachments-title">附件（{document.attachments.length}）</h2>
        <ul>{document.attachments.map((attachment) => <li key={attachment.id}>
          <a href={attachment.link_url || documentsApi.attachmentDownloadUrl(document.id, attachment.id)}
            target="_blank" rel="noreferrer">{attachment.display_name || attachment.filename}</a>
        </li>)}</ul>
      </section>}
      {document.regulation_id && <section className="administrative-document-supplement no-print">
        <Link href={`/regulations/${document.regulation_id}`}>相關法規與沿革</Link>
      </section>}
      <details className="administrative-document-supplement no-print">
        <summary>文件基本資料</summary>
        <dl>
          <dt>標題</dt><dd>{document.title}</dd>
          {document.summary && <><dt>摘要</dt><dd>{document.summary}</dd></>}
          <dt>文書類別</dt><dd>{category}</dd>
          <dt>發文日期</dt><dd>{formatDate(document.issued_at)}</dd>
          {document.handler_unit && <><dt>承辦單位</dt><dd>{document.handler_unit}</dd></>}
          {document.due_date && <><dt>限辦日期</dt><dd>{formatDate(document.due_date)}</dd></>}
        </dl>
      </details>
    </div>
  );
}
