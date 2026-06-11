"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, emailApi } from "@/lib/api";
import type {
  EmailAnalyticsOut,
  EmailCampaignRecipientOut,
  EmailComposePayload,
  EmailMessageDetailOut,
  EmailMessageOut,
  EmailStatus,
  EmailTemplateOut,
} from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import Modal from "@/components/ui/Modal";
import { useOrgOptions } from "@/components/ui/targeting";

/** 從訊息詳情重建預覽用 payload，呼叫 /email/preview 取得與實寄一致的品牌 HTML。 */
function detailToPreviewPayload(d: EmailMessageDetailOut): EmailComposePayload {
  return {
    subject: d.subject,
    heading: d.heading,
    preview_text: d.preview_text,
    accent_color: d.accent_color,
    background_color: d.background_color,
    content_background_color: d.content_background_color,
    body_line_height: d.body_line_height,
    paragraph_spacing: d.paragraph_spacing,
    footer_text: d.footer_text,
    show_system_footer: d.show_system_footer,
    body: d.body,
    banner_image_url: d.banner_image_url,
    banner_image_alt: d.banner_image_alt,
    card_rows: d.card_rows,
    cta_label: d.cta_label,
    cta_url: d.cta_url,
    buttons: d.buttons,
    blocks: d.blocks,
    recipients: d.recipient_spec,
    variable_definitions: d.variable_definitions,
    default_variables: d.default_variables,
    recipient_variables: d.recipient_variables,
    preview_variables: d.default_variables,
    preview_recipient: null,
  };
}

const TABS: { key: string; label: string }[] = [
  { key: "", label: "全部" },
  { key: "draft", label: "草稿" },
  { key: "scheduled", label: "已排程" },
  { key: "queued", label: "寄送中" },
  { key: "sent", label: "已寄送" },
  { key: "failed", label: "失敗" },
  { key: "retrying", label: "重試中" },
  { key: "dead", label: "停止重試" },
  { key: "partial", label: "部分失敗" },
];

const STATUS_META: Record<EmailStatus, { label: string; color: string }> = {
  draft: { label: "草稿", color: "var(--text-muted)" },
  scheduled: { label: "已排程", color: "var(--primary)" },
  queued: { label: "寄送中", color: "var(--primary)" },
  sent: { label: "已寄送", color: "var(--success)" },
  failed: { label: "失敗", color: "var(--danger)" },
  retrying: { label: "重試中", color: "var(--warning)" },
  dead: { label: "停止重試", color: "var(--danger)" },
  partial: { label: "部分失敗", color: "var(--warning)" },
  cancelled: { label: "已取消", color: "var(--text-muted)" },
};

const RECIPIENT_STATUS_META: Record<
  EmailCampaignRecipientOut["status"],
  { label: string; color: string }
> = {
  queued: { label: "等待寄送", color: "var(--primary)" },
  sent: { label: "寄送成功", color: "var(--success)" },
  failed: { label: "寄送失敗", color: "var(--danger)" },
  retrying: { label: "等待重試", color: "var(--warning)" },
  dead: { label: "停止重試", color: "var(--danger)" },
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" });
}

export default function EmailLogsPage() {
  const orgOptions = useOrgOptions();
  const [tab, setTab] = useState("");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [orgId, setOrgId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState<EmailTemplateOut[]>([]);
  const [rows, setRows] = useState<EmailMessageOut[]>([]);
  const [detail, setDetail] = useState<EmailMessageDetailOut | null>(null);
  const [detailRecipients, setDetailRecipients] = useState<EmailCampaignRecipientOut[]>([]);
  const [previewRecipientId, setPreviewRecipientId] = useState<string | null>(null);
  const [recipientStatusFilter, setRecipientStatusFilter] = useState("");
  const [detailAnalytics, setDetailAnalytics] = useState<EmailAnalyticsOut | null>(null);
  const [detailHtml, setDetailHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    emailApi
      .listMessages({
        status: tab || undefined,
        q: query.trim() || undefined,
        org_id: orgId || undefined,
        template_id: templateId || undefined,
        date_from: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
        date_to: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined,
        limit: 100,
      })
      .then(setRows)
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [tab, query, dateFrom, dateTo, orgId, templateId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    emailApi.listTemplates().then(setTemplates).catch(() => undefined);
  }, []);

  const sendDraft = async (id: string) => {
    setBusyId(id);
    try {
      await emailApi.sendMessage(id);
      toast.success("已排入寄送佇列");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "寄送失敗");
    } finally {
      setBusyId(null);
    }
  };

  const resend = async (id: string) => {
    setBusyId(id);
    try {
      await emailApi.resendMessage(id);
      toast.success("已將未送達的收件人重新排入寄送佇列");
      if (detail?.id === id) {
        const [nextDetail, recipients] = await Promise.all([
          emailApi.getMessage(id),
          emailApi.listMessageRecipients(id, { limit: 1000 }),
        ]);
        setDetail(nextDetail);
        setDetailRecipients(recipients);
      }
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "重新寄送失敗");
    } finally {
      setBusyId(null);
    }
  };

  const createFromMessage = async (id: string) => {
    setBusyId(id);
    try {
      const draft = await emailApi.cloneMessage(id, "all");
      window.location.href = `/email?draft=${draft.id}`;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "建立新信失敗");
      setBusyId(null);
    }
  };

  const showDetail = async (id: string) => {
    setBusyId(id);
    try {
      const [d, recipients, analytics] = await Promise.all([
        emailApi.getMessage(id),
        emailApi.listMessageRecipients(id, { limit: 1000 }),
        emailApi.getAnalytics(id),
      ]);
      setDetail(d);
      setDetailRecipients(recipients);
      setDetailAnalytics(analytics);
      setRecipientStatusFilter("");
      setDetailHtml(null);
      if (recipients[0]) {
        setPreviewRecipientId(recipients[0].id);
        emailApi
          .previewMessageRecipient(id, recipients[0].id)
          .then((r) => setDetailHtml(r.html))
          .catch(() => setDetailHtml(""));
      } else {
        setPreviewRecipientId(null);
        emailApi
          .preview(detailToPreviewPayload(d))
          .then((r) => setDetailHtml(r.html))
          .catch(() => setDetailHtml(""));
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "載入詳情失敗");
    } finally {
      setBusyId(null);
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setDetailRecipients([]);
    setPreviewRecipientId(null);
    setDetailAnalytics(null);
    setRecipientStatusFilter("");
    setDetailHtml(null);
  };

  const previewRecipient = async (recipient: EmailCampaignRecipientOut) => {
    if (!detail) return;
    setPreviewRecipientId(recipient.id);
    setDetailHtml(null);
    try {
      const result = await emailApi.previewMessageRecipient(detail.id, recipient.id);
      setDetailHtml(result.html);
    } catch (e) {
      setDetailHtml("");
      toast.error(e instanceof ApiError ? e.message : "載入收件人預覽失敗");
    }
  };

  const removeMessage = async (id: string, scheduled: boolean) => {
    if (!confirm(scheduled ? "確定取消這封預約郵件？" : "確定刪除這封草稿？")) return;
    setBusyId(id);
    try {
      await emailApi.deleteMessage(id);
      toast.success(scheduled ? "已取消預約" : "草稿已刪除");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失敗");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            EMAIL LOGS
          </p>
          <h1 className="mt-1 text-xl font-semibold">寄信紀錄</h1>
        </div>
        <Link href="/email" className="btn btn-primary btn-sm">
          寄送新信件
        </Link>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            style={
              tab === t.key
                ? { background: "var(--primary)", color: "#1a1a2e" }
                : { background: "var(--bg-elevated)", color: "var(--text-muted)" }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <section className="card grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_12rem_12rem_auto]">
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋郵件主旨" />
        <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="開始日期" />
        <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="結束日期" />
        <select className="input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          <option value="">全部組織</option>
          {orgOptions.map((org) => <option key={org.value} value={org.value}>{org.label}</option>)}
        </select>
        <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">全部範本</option>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={() => { setQuery(""); setDateFrom(""); setDateTo(""); setOrgId(""); setTemplateId(""); }}>清除</button>
      </section>

      <section className="card overflow-hidden">
        {loading ? (
          <div className="p-4">
            <ListPageSkeleton rows={5} showHeader={false} showFilters={false} />
          </div>
        ) : rows.length === 0 ? (
          <SmartEmptyState
            reason={tab ? "filtered" : "none"}
            subject="寄信紀錄"
            onClearFilters={() => setTab("")}
            message={tab ? undefined : "尚未發送任何 Email，前往「Email」頁面開始寄信"}
          />
        ) : (
          <ul>
            {rows.map((m) => {
              const meta = STATUS_META[m.status];
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {m.subject}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      {m.sender_name ?? "—"} · {m.recipient_count} 人 ·{" "}
                      {m.status === "scheduled"
                        ? `預約 ${fmt(m.scheduled_at)}`
                        : fmt(m.created_at)}
                    </p>
                  </div>
                  <span className="text-xs font-semibold" style={{ color: meta.color }}>
                    {meta.label}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busyId === m.id}
                      onClick={() => showDetail(m.id)}
                    >
                      詳情
                    </button>
                    {m.status === "draft" && (
                      <>
                        <Link href={`/email?draft=${m.id}`} className="btn btn-ghost btn-sm">
                          編輯
                        </Link>
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={busyId === m.id}
                          onClick={() => sendDraft(m.id)}
                        >
                          送出
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={busyId === m.id}
                          onClick={() => removeMessage(m.id, false)}
                        >
                          刪除
                        </button>
                      </>
                    )}
                    {m.status === "scheduled" && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busyId === m.id}
                        onClick={() => removeMessage(m.id, true)}
                      >
                        取消預約
                      </button>
                    )}
                    {(["queued", "failed", "retrying", "dead", "partial"] as EmailStatus[]).includes(
                      m.status,
                    ) && (
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={busyId === m.id}
                        onClick={() => resend(m.id)}
                        title="把卡住或失敗的收件人重新排入寄送佇列"
                      >
                        重新寄送
                      </button>
                    )}
                    {m.status !== "draft" && m.recipient_count > 0 && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busyId === m.id}
                        onClick={() => createFromMessage(m.id)}
                        title="擷取這封信的實際收件名單、內容與附件建立新草稿"
                      >
                        沿用名單建立新信
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {detail && (
        <Modal
          title={detail.subject || "信件詳情"}
          onClose={closeDetail}
          size="xl"
          footer={
            <>
              {(["queued", "failed", "retrying", "dead", "partial"] as EmailStatus[]).includes(
                detail.status,
              ) && (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={busyId === detail.id}
                  onClick={() => resend(detail.id)}
                >
                  重新寄送未送達
                </button>
              )}
              {detail.recipient_count > 0 && (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={busyId === detail.id}
                  onClick={() => createFromMessage(detail.id)}
                >
                  沿用名單建立新信
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={closeDetail}>
                關閉
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {detail.sender_name ?? "—"} · {detail.recipient_count} 人 · {fmt(detail.created_at)} ·{" "}
              <span style={{ color: STATUS_META[detail.status].color }}>
                {STATUS_META[detail.status].label}
              </span>
            </p>

            {detail.status === "queued" && (detail.recipient_status_counts.queued ?? 0) > 0 && (
              <p className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                仍有 {detail.recipient_status_counts.queued} 位收件人停留在「寄送中」。若長時間沒有變成「已寄送」，通常代表背景寄信服務（Celery worker）未啟動，或 Resend 寄信金鑰未設定。請確認服務運作後，再按「重新寄送未送達」補寄。
              </p>
            )}

            <div className="grid gap-2 sm:grid-cols-5">
              {(["queued", "sent", "failed", "retrying", "dead"] as const).map((key) => (
                <div key={key} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {RECIPIENT_STATUS_META[key].label}
                  </p>
                  <p className="mt-1 text-lg font-semibold">{detail.recipient_status_counts[key] ?? 0}</p>
                </div>
              ))}
            </div>

            {detailAnalytics && (
              <div className="grid gap-2 sm:grid-cols-4">
                {[
                  ["投遞率", detailAnalytics.delivery_rate],
                  ["退信率", detailAnalytics.bounce_rate],
                  ["開信率（估計）", detailAnalytics.open_rate_estimated],
                  ["點擊率", detailAnalytics.click_rate],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
                    <p className="mt-1 text-lg font-semibold">{(Number(value) * 100).toFixed(1)}%</p>
                  </div>
                ))}
              </div>
            )}

            {detail.error_detail && (
              <p className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
                {detail.error_detail}
              </p>
            )}

            {detail.recent_errors.length > 0 && (
              <div>
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                  最近錯誤
                </p>
                <ul className="mt-2 space-y-1 text-sm" style={{ color: "var(--danger)" }}>
                  {detail.recent_errors.map((err, idx) => (
                    <li key={`${idx}-${err}`}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                  收件人寄送明細（{detailRecipients.length}）
                </p>
                <div className="flex gap-2">
                  <select className="input py-1 text-xs" value={recipientStatusFilter} onChange={(e) => setRecipientStatusFilter(e.target.value)}>
                    <option value="">全部狀態</option>
                    {Object.entries(RECIPIENT_STATUS_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                  </select>
                  <a className="btn btn-ghost btn-sm" href={emailApi.exportUrl(detail.id, "csv")}>CSV</a>
                  <a className="btn btn-ghost btn-sm" href={emailApi.exportUrl(detail.id, "xlsx")}>XLSX</a>
                </div>
              </div>
              {detailRecipients.length > 0 ? (
                <div className="mt-2 max-h-72 overflow-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
                  <table className="w-full min-w-[760px] text-xs">
                    <thead className="sticky top-0" style={{ background: "var(--bg-elevated)" }}>
                      <tr className="text-left" style={{ color: "var(--text-muted)" }}>
                        <th className="px-3 py-2">收件人</th>
                        <th className="px-3 py-2">狀態</th>
                        <th className="px-3 py-2">嘗試</th>
                        <th className="px-3 py-2">時間／錯誤</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {detailRecipients
                        .filter((recipient) => !recipientStatusFilter || recipient.status === recipientStatusFilter)
                        .map((recipient) => {
                        const statusMeta = RECIPIENT_STATUS_META[recipient.status];
                        return (
                          <tr key={recipient.id} style={{ borderTop: "1px solid var(--border)" }}>
                            <td className="px-3 py-2">
                              <p className="font-medium">{recipient.name || "—"}</p>
                              <p className="font-mono" style={{ color: "var(--text-muted)" }}>
                                {recipient.email}
                              </p>
                            </td>
                            <td className="px-3 py-2 font-semibold" style={{ color: statusMeta.color }}>
                              {statusMeta.label}
                            </td>
                            <td className="px-3 py-2">{recipient.attempt_count}</td>
                            <td className="max-w-72 px-3 py-2">
                              {recipient.error_detail ? (
                                <span style={{ color: "var(--danger)" }}>{recipient.error_detail}</span>
                              ) : recipient.sent_at ? (
                                fmt(recipient.sent_at)
                              ) : recipient.next_retry_at ? (
                                `下次重試：${fmt(recipient.next_retry_at)}`
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                className={previewRecipientId === recipient.id ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm"}
                                onClick={() => previewRecipient(recipient)}
                              >
                                預覽
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  {detail.status === "draft" || detail.status === "scheduled"
                    ? "寄出時才會解析實際收件名單。"
                    : "目前沒有收件人寄送快照。"}
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                {previewRecipientId
                  ? `個人化郵件預覽：${
                      detailRecipients.find((row) => row.id === previewRecipientId)?.email ?? ""
                    }`
                  : "信件內容"}
              </p>
              <div
                className="mt-2 overflow-hidden rounded-lg border"
                style={{ borderColor: "var(--border)" }}
              >
                {detailHtml === null ? (
                  <div className="flex h-72 items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
                    載入內容預覽中…
                  </div>
                ) : detailHtml ? (
                  <iframe
                    title="信件內容預覽"
                    srcDoc={detailHtml}
                    sandbox=""
                    className="h-[480px] w-full"
                    style={{ background: "#fff" }}
                  />
                ) : (
                  <div className="space-y-2 p-3 text-sm" style={{ color: "var(--text-secondary)" }}>
                    {detail.heading && <p className="font-semibold">{detail.heading}</p>}
                    <p className="whitespace-pre-wrap">{detail.body || "（無內文）"}</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      無法渲染完整版型預覽，已改顯示原始內文。
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
