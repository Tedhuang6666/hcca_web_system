"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authApi, emailApi, apiErrorMessage } from "@/lib/api";
import { prepareEmailPreviewHtml } from "@/lib/email-preview";
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
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import Modal from "@/components/ui/Modal";
import { useOrgOptions } from "@/components/ui/targeting";
import { confirmAction } from "@/components/ui/ConfirmDialog";

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
    card_rows: d.card_rows as EmailComposePayload["card_rows"],
    cta_label: d.cta_label,
    cta_url: d.cta_url,
    buttons: d.buttons as EmailComposePayload["buttons"],
    blocks: d.blocks as EmailComposePayload["blocks"],
    recipients: d.recipient_spec as EmailComposePayload["recipients"],
    variable_definitions: d.variable_definitions as EmailComposePayload["variable_definitions"],
    conditional_rules: d.conditional_rules,
    default_variables: d.default_variables as EmailComposePayload["default_variables"],
    recipient_variables: d.recipient_variables as EmailComposePayload["recipient_variables"],
    preview_variables: d.default_variables as EmailComposePayload["preview_variables"],
    preview_recipient: null,
    track_opens: d.track_opens,
    track_clicks: d.track_clicks,
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

const RESENDABLE_STATUSES: EmailStatus[] = ["queued", "failed", "retrying", "dead", "partial"];
const RESEND_PAGE_SIZE = 200;
const RESEND_CONCURRENCY = 5;

const STATUS_META: Record<EmailStatus, { label: string; tone: string }> = {
  draft: { label: "草稿", tone: "text-[var(--text-muted)]" },
  scheduled: { label: "已排程", tone: "text-[var(--primary-text)]" },
  queued: { label: "寄送中", tone: "text-[var(--primary-text)]" },
  sent: { label: "已寄送", tone: "text-[var(--success)]" },
  failed: { label: "失敗", tone: "text-[var(--danger)]" },
  retrying: { label: "重試中", tone: "text-[var(--warning)]" },
  dead: { label: "停止重試", tone: "text-[var(--danger)]" },
  partial: { label: "部分失敗", tone: "text-[var(--warning)]" },
  cancelled: { label: "已取消", tone: "text-[var(--text-muted)]" },
};

const RECIPIENT_STATUS_META: Record<
  EmailCampaignRecipientOut["status"],
  { label: string; tone: string }
> = {
  queued: { label: "等待寄送", tone: "text-[var(--primary-text)]" },
  sent: { label: "寄送成功", tone: "text-[var(--success)]" },
  failed: { label: "寄送失敗", tone: "text-[var(--danger)]" },
  retrying: { label: "等待重試", tone: "text-[var(--warning)]" },
  dead: { label: "停止重試", tone: "text-[var(--danger)]" },
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" });
}

export default function EmailLogsPage() {
  const router = useRouter();
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
  const [batchResending, setBatchResending] = useState(false);
  const isSystemNotification = detail?.sender_id === null;

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
      .catch((e) => toast.error(apiErrorMessage(e, "載入失敗")))
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
      toast.error(apiErrorMessage(e, "寄送失敗"));
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
      toast.error(apiErrorMessage(e, "重新寄送失敗"));
    } finally {
      setBusyId(null);
    }
  };

  const resendRecent = async () => {
    setBatchResending(true);
    try {
      const user = await authApi.me();
      const dateFrom = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const messageGroups = await Promise.all(
        RESENDABLE_STATUSES.map(async (status) => {
          const messages: EmailMessageOut[] = [];
          let offset = 0;
          while (true) {
            const page = await emailApi.listMessages({
              status,
              date_from: dateFrom,
              limit: RESEND_PAGE_SIZE,
              offset,
              mine: !user.is_superuser,
            });
            messages.push(...page);
            if (page.length < RESEND_PAGE_SIZE) break;
            offset += page.length;
          }
          return messages;
        }),
      );
      const messages = messageGroups.flat();

      if (messages.length === 0) {
        toast.info("近三天沒有你可重新寄送的未送達郵件");
        return;
      }
      if (
        !(await confirmAction({
          title: `批次重新寄送 ${messages.length} 封郵件？`,
          description: "近三天內仍有未送達收件人的郵件會重新寄出，已送達者不會重寄。仍在處理中的郵件也會重新排入，原佇列若仍運作可能造成重複寄送。",
          confirmLabel: "重新寄送",
        }))
      ) {
        return;
      }

      let queuedCount = 0;
      let failedCount = 0;
      for (let index = 0; index < messages.length; index += RESEND_CONCURRENCY) {
        const batch = messages.slice(index, index + RESEND_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((message) => emailApi.resendMessage(message.id)),
        );
        for (const result of results) {
          if (result.status === "fulfilled") queuedCount += 1;
          else failedCount += 1;
        }
      }

      if (queuedCount > 0) {
        toast.success(`已將 ${queuedCount} 封郵件的未送達收件人排入寄送佇列`);
      }
      if (failedCount > 0) {
        toast.error(`${failedCount} 封郵件未能重新排入，可能已全數送達或發生錯誤，請查看各封寄信紀錄`);
      }
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "批次重新寄送失敗"));
    } finally {
      setBatchResending(false);
    }
  };

  const createFromMessage = async (id: string) => {
    setBusyId(id);
    try {
      const draft = await emailApi.cloneMessage(id, "all");
      router.push(`/email?draft=${draft.id}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "建立新信失敗"));
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
          .then(async (r) => setDetailHtml(await prepareEmailPreviewHtml(r.html)))
          .catch(() => setDetailHtml(""));
      } else {
        setPreviewRecipientId(null);
        emailApi
          .preview(detailToPreviewPayload(d))
          .then(async (r) => setDetailHtml(await prepareEmailPreviewHtml(r.html)))
          .catch(() => setDetailHtml(""));
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入詳情失敗"));
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
      setDetailHtml(await prepareEmailPreviewHtml(result.html));
    } catch (e) {
      setDetailHtml("");
      toast.error(apiErrorMessage(e, "載入收件人預覽失敗"));
    }
  };

  const removeMessage = async (id: string, scheduled: boolean) => {
    if (!(await confirmAction({ title: scheduled ? "確定取消這封預約郵件？" : "確定刪除這封草稿？", danger: true }))) return;
    setBusyId(id);
    try {
      await emailApi.deleteMessage(id);
      toast.success(scheduled ? "已取消預約" : "草稿已刪除");
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "操作失敗"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">寄信紀錄</h1>
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <button
            type="button"
            className="btn btn-secondary btn-sm min-h-11 w-full whitespace-normal px-3 leading-5 sm:w-auto"
            disabled={batchResending || busyId !== null}
            onClick={() => void resendRecent()}
            title="近 72 小時內未送達的郵件；超管另含系統通知。"
          >
            {batchResending ? "批次處理中…" : "批次重新寄送近三天"}
          </button>
          <Link href="/email" className="btn btn-primary btn-sm min-h-11 w-full sm:w-auto">
            寄送新信件
          </Link>
        </div>
      </header>

      <div
        className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
        role="group"
        aria-label="寄信狀態篩選"
        tabIndex={0}>
        <div className="flex w-max min-w-full gap-1.5 pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`min-h-11 shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${tab === t.key ? "bg-[var(--primary)] text-[#1a1a2e]" : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
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
        <button className="btn btn-ghost btn-sm min-h-11" onClick={() => { setQuery(""); setDateFrom(""); setDateTo(""); setOrgId(""); setTemplateId(""); }}>清除</button>
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
            message={tab ? undefined : "尚未寄送郵件"}
          />
        ) : (
          <ul>
            {rows.map((m) => {
              const meta = STATUS_META[m.status as EmailStatus];
              return (
                <li
                  key={m.id}
                  className="flex flex-col gap-3 border-b border-[var(--border)] p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1 sm:px-5 sm:py-3"
                >
                  <div className="min-w-0 w-full flex-1 sm:w-auto">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {m.subject}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {m.sender_name ?? (m.sender_id === null ? "系統自動通知" : "—")} · {m.recipient_count} 人 ·{" "}
                      {m.status === "scheduled"
                        ? `預約 ${fmt(m.scheduled_at)}`
                        : fmt(m.created_at)}
                    </p>
                    {m.recipient_preview?.length ? (
                      <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                        收件：{m.recipient_preview.join("、")}{m.recipient_count > m.recipient_preview.length ? "…" : ""}
                      </p>
                    ) : null}
                  </div>
                  <span className={`text-xs font-semibold ${meta.tone}`}>
                    {meta.label}
                  </span>
                  <div className="grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                    <button
                      className="btn btn-ghost btn-sm min-h-11 w-full sm:w-auto"
                      disabled={busyId === m.id}
                      onClick={() => showDetail(m.id)}
                    >
                      詳情
                    </button>
                    {m.status === "draft" && (
                      <>
                        <Link href={`/email?draft=${m.id}`} className="btn btn-ghost btn-sm min-h-11 w-full sm:w-auto">
                          編輯
                        </Link>
                        <button
                          className="btn btn-secondary btn-sm min-h-11 w-full sm:w-auto"
                          disabled={busyId === m.id}
                          onClick={() => sendDraft(m.id)}
                        >
                          送出
                        </button>
                        <button
                          className="btn btn-ghost btn-sm min-h-11 w-full sm:w-auto"
                          disabled={busyId === m.id}
                          onClick={() => removeMessage(m.id, false)}
                        >
                          刪除
                        </button>
                      </>
                    )}
                    {m.status === "scheduled" && (
                      <button
                        className="btn btn-ghost btn-sm min-h-11 w-full sm:w-auto"
                        disabled={busyId === m.id}
                        onClick={() => removeMessage(m.id, true)}
                      >
                        取消預約
                      </button>
                    )}
                    {RESENDABLE_STATUSES.includes(m.status as EmailStatus) && (
                      <button
                        className="btn btn-secondary btn-sm min-h-11 w-full sm:w-auto"
                        disabled={busyId === m.id}
                        onClick={() => resend(m.id)}
                        title="把卡住或失敗的收件人重新排入寄送佇列"
                      >
                        重新寄送
                      </button>
                    )}
                    {m.status !== "draft" && m.recipient_count > 0 && (
                      <button
                        className="btn btn-ghost btn-sm min-h-11 w-full sm:w-auto"
                        disabled={busyId === m.id}
                        onClick={() => createFromMessage(m.id)}
                        title="擷取這封信的實際收件名單、內容與附件建立新草稿"
                      >
                        {m.sender_id === null ? "建立可編輯副本" : "沿用名單建立新信"}
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
              {RESENDABLE_STATUSES.includes(detail.status as EmailStatus) && (
                <button
                  className="btn btn-secondary btn-sm min-h-11"
                  disabled={busyId === detail.id}
                  onClick={() => resend(detail.id)}
                >
                  重新寄送未送達
                </button>
              )}
              {detail.recipient_count > 0 && (
                <button
                  className="btn btn-secondary btn-sm min-h-11"
                  disabled={busyId === detail.id}
                  onClick={() => createFromMessage(detail.id)}
                >
                  {isSystemNotification ? "建立可編輯副本" : "沿用名單建立新信"}
                </button>
              )}
              <button className="btn btn-ghost btn-sm min-h-11" onClick={closeDetail}>
                關閉
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-[var(--text-muted)]">
              {detail.sender_name ?? (isSystemNotification ? "系統自動通知" : "—")} · {detail.recipient_count} 人 · {fmt(detail.created_at)} ·{" "}
              <span className={STATUS_META[detail.status as EmailStatus].tone}>
                {STATUS_META[detail.status as EmailStatus].label}
              </span>
            </p>

            {isSystemNotification && (
              <div
                className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-dim)] px-3 py-3 text-sm text-[var(--text-primary)]"
              >
                <p className="font-semibold">系統自動通知</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  以下為實際寄送名單，依通知規則與個人偏好決定。增刪收件人請建立可編輯副本。
                </p>
              </div>
            )}

            {detail.status === "queued" && (detail.recipient_status_counts.queued ?? 0) > 0 && (
              <p className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-muted)]">
                仍有 {detail.recipient_status_counts.queued} 位收件人停留在「寄送中」。若長時間沒有變成「已寄送」，通常代表背景寄信服務（Celery worker）未啟動，或 Resend 寄信金鑰未設定。請確認服務運作後，再按「重新寄送未送達」補寄。
              </p>
            )}

            <div className="grid gap-2 sm:grid-cols-5">
              {(["queued", "sent", "failed", "retrying", "dead"] as const).map((key) => (
                <div key={key} className="rounded-lg border border-[var(--border)] px-3 py-2">
                  <p className="text-xs text-[var(--text-muted)]">
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
                  <div key={String(label)} className="rounded-lg border border-[var(--border)] px-3 py-2">
                    <p className="text-xs text-[var(--text-muted)]">{label}</p>
                    <p className="mt-1 text-lg font-semibold">{(Number(value) * 100).toFixed(1)}%</p>
                  </div>
                ))}
              </div>
            )}

            {detail.error_detail && (
              <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
                {detail.error_detail}
              </p>
            )}

            {detail.recent_errors.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)]">
                  最近錯誤
                </p>
                <ul className="mt-2 space-y-1 text-sm text-[var(--danger)]">
                  {detail.recent_errors.map((err, idx) => (
                    <li key={`${idx}-${err}`}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-semibold text-[var(--text-muted)]">
                  收件人寄送明細（{detailRecipients.length}）
                </p>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <select className="input col-span-2 min-h-11 py-1 text-xs sm:col-span-1" value={recipientStatusFilter} onChange={(e) => setRecipientStatusFilter(e.target.value)}>
                    <option value="">全部狀態</option>
                    {Object.entries(RECIPIENT_STATUS_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                  </select>
                  <AnimatedDownloadButton className="btn btn-ghost btn-sm min-h-11 w-full sm:w-auto" href={emailApi.exportUrl(detail.id, "csv")} filename="email-log.csv" label="CSV" />
                  <AnimatedDownloadButton className="btn btn-ghost btn-sm min-h-11 w-full sm:w-auto" href={emailApi.exportUrl(detail.id, "xlsx")} filename="email-log.xlsx" label="XLSX" />
                </div>
              </div>
              {detailRecipients.length > 0 ? (
                <div
                  className="mt-2 max-h-72 overflow-auto rounded-lg border border-[var(--border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                  role="region"
                  aria-label="收件人寄送明細，可左右捲動查看完整欄位"
                  tabIndex={0}>
                  <table className="w-full min-w-[760px] text-xs">
                    <thead className="sticky top-0 bg-[var(--bg-elevated)]">
                      <tr className="text-left text-[var(--text-muted)]">
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
                          <tr key={recipient.id} className="border-t border-[var(--border)]">
                            <td className="px-3 py-2">
                              <p className="font-medium">{recipient.name || "—"}</p>
                              <p className="font-mono text-[var(--text-muted)]">
                                {recipient.email}
                              </p>
                            </td>
                            <td className={`px-3 py-2 font-semibold ${statusMeta.tone}`}>
                              {statusMeta.label}
                            </td>
                            <td className="px-3 py-2">{recipient.attempt_count}</td>
                            <td className="max-w-72 px-3 py-2">
                              {recipient.error_detail ? (
                                <span className="text-[var(--danger)]">{recipient.error_detail}</span>
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
                                className={`${previewRecipientId === recipient.id ? "btn btn-secondary" : "btn btn-ghost"} btn-sm min-h-11`}
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
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  {detail.status === "draft" || detail.status === "scheduled"
                    ? "寄出時才會解析實際收件名單。"
                    : "目前沒有收件人寄送快照。"}
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)]">
                {previewRecipientId
                  ? `個人化郵件預覽：${
                      detailRecipients.find((row) => row.id === previewRecipientId)?.email ?? ""
                    }`
                  : "信件內容"}
              </p>
              <div className="mt-2 overflow-hidden rounded-lg border border-[var(--border)]">
                {detailHtml === null ? (
                  <div className="flex h-72 items-center justify-center text-xs text-[var(--text-muted)]">
                    載入內容預覽中…
                  </div>
                ) : detailHtml ? (
                  <iframe
                    title="信件內容預覽"
                    srcDoc={detailHtml}
                    sandbox=""
                    className="h-[360px] w-full bg-white sm:h-[480px]"
                  />
                ) : (
                  <div className="space-y-2 p-3 text-sm text-[var(--text-secondary)]">
                    {detail.heading && <p className="font-semibold">{detail.heading}</p>}
                    <p className="whitespace-pre-wrap">{detail.body || "（無內文）"}</p>
                    <p className="text-xs text-[var(--text-muted)]">
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
