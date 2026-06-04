"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, emailApi } from "@/lib/api";
import type {
  EmailComposePayload,
  EmailMessageDetailOut,
  EmailMessageOut,
  EmailStatus,
} from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import Modal from "@/components/ui/Modal";

/** 從訊息詳情重建預覽用 payload，呼叫 /email/preview 取得與實寄一致的品牌 HTML。 */
function detailToPreviewPayload(d: EmailMessageDetailOut): EmailComposePayload {
  return {
    subject: d.subject,
    heading: d.heading,
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
  };
}

const TABS: { key: string; label: string }[] = [
  { key: "", label: "全部" },
  { key: "draft", label: "草稿" },
  { key: "scheduled", label: "已排程" },
  { key: "queued", label: "寄送中" },
  { key: "sent", label: "已寄送" },
  { key: "failed", label: "失敗" },
  { key: "partial", label: "部分失敗" },
];

const STATUS_META: Record<EmailStatus, { label: string; color: string }> = {
  draft: { label: "草稿", color: "var(--text-muted)" },
  scheduled: { label: "已排程", color: "var(--primary)" },
  queued: { label: "寄送中", color: "var(--primary)" },
  sent: { label: "已寄送", color: "var(--success)" },
  failed: { label: "失敗", color: "var(--danger)" },
  partial: { label: "部分失敗", color: "var(--warning)" },
  cancelled: { label: "已取消", color: "var(--text-muted)" },
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" });
}

export default function EmailLogsPage() {
  const [tab, setTab] = useState("");
  const [rows, setRows] = useState<EmailMessageOut[]>([]);
  const [detail, setDetail] = useState<EmailMessageDetailOut | null>(null);
  const [detailHtml, setDetailHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    emailApi
      .listMessages({ status: tab || undefined, limit: 100 })
      .then(setRows)
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

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
      if (detail?.id === id) setDetail(await emailApi.getMessage(id));
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "重新寄送失敗");
    } finally {
      setBusyId(null);
    }
  };

  const showDetail = async (id: string) => {
    setBusyId(id);
    try {
      const d = await emailApi.getMessage(id);
      setDetail(d);
      // 內文預覽：用詳情重建 payload 取得品牌 HTML（與實際寄出一致）。
      // 必填變數缺值等情形預覽端點會 422，靜默退回不顯示，不擋詳情。
      setDetailHtml(null);
      emailApi
        .preview(detailToPreviewPayload(d))
        .then((r) => setDetailHtml(r.html))
        .catch(() => setDetailHtml(""));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "載入詳情失敗");
    } finally {
      setBusyId(null);
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setDetailHtml(null);
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
                    {(m.status === "queued" || m.status === "failed" || m.status === "partial") && (
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={busyId === m.id}
                        onClick={() => resend(m.id)}
                        title="把卡住或失敗的收件人重新排入寄送佇列"
                      >
                        重新寄送
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
              {(detail.status === "queued" || detail.status === "failed" || detail.status === "partial") && (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={busyId === detail.id}
                  onClick={() => resend(detail.id)}
                >
                  重新寄送未送達
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

            <div className="grid gap-2 sm:grid-cols-3">
              {(["queued", "sent", "failed"] as const).map((key) => (
                <div key={key} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {STATUS_META[key].label}
                  </p>
                  <p className="mt-1 text-lg font-semibold">{detail.recipient_status_counts[key] ?? 0}</p>
                </div>
              ))}
            </div>

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

            {/* 收件人清單 */}
            <div>
              <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                收件人{detail.resolved_emails.length > 0 ? `（${detail.resolved_emails.length}）` : ""}
              </p>
              {detail.resolved_emails.length > 0 ? (
                <div
                  className="mt-2 max-h-40 overflow-y-auto rounded-lg border p-2 text-xs"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                >
                  <ul className="space-y-0.5">
                    {detail.resolved_emails.map((addr) => (
                      <li key={addr} className="truncate font-mono">{addr}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  {detail.status === "draft" || detail.status === "scheduled"
                    ? "寄出時才會解析實際收件名單。"
                    : "無收件人明細（或你沒有檢視收件人 Email 的權限）。"}
                </p>
              )}
            </div>

            {/* 信件內容預覽 */}
            <div>
              <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                信件內容
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
