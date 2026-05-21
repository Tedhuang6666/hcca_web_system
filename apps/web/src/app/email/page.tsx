"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import Modal from "@/components/ui/Modal";
import RichTextarea from "@/components/ui/RichTextarea";
import RecipientPicker from "@/components/email/RecipientPicker";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";
import { ApiError, emailApi } from "@/lib/api";
import type { EmailCardRow, EmailComposePayload, RecipientSelector } from "@/lib/types";

const EMPTY_RECIPIENTS: RecipientSelector = {
  user_ids: [],
  position_ids: [],
  org_ids: [],
  include_all: false,
  include_school: false,
};

/** 情境預設：選取後預填主標題、重點卡片與行動按鈕文字 */
const PRESETS: {
  key: string;
  label: string;
  heading: string;
  rows: EmailCardRow[];
  ctaLabel: string;
}[] = [
  {
    key: "plain",
    label: "一般通知",
    heading: "重要通知",
    rows: [{ label: "重點", value: "請填入這封信最需要被看見的一句話" }],
    ctaLabel: "查看詳情",
  },
  {
    key: "meeting",
    label: "會議通知",
    heading: "會議通知",
    rows: [
      { label: "時間", value: "例：2026/05/20 19:00" },
      { label: "地點", value: "例：學生會辦公室" },
      { label: "出席對象", value: "例：全體學生代表" },
    ],
    ctaLabel: "查看會議資料",
  },
  {
    key: "signin",
    label: "簽到開放",
    heading: "簽到開放通知",
    rows: [
      { label: "活動名稱", value: "例：第 75 屆第 3 次院會" },
      { label: "簽到時段", value: "例：18:30 - 19:10" },
    ],
    ctaLabel: "前往簽到",
  },
  {
    key: "vote",
    label: "投票開放",
    heading: "投票開放通知",
    rows: [
      { label: "投票案由", value: "例：總預算案二讀表決" },
      { label: "開放時間", value: "例：2026/05/20 19:30" },
      { label: "截止時間", value: "例：2026/05/20 21:00" },
    ],
    ctaLabel: "前往投票",
  },
  {
    key: "election",
    label: "選舉通知",
    heading: "選舉通知",
    rows: [
      { label: "選舉名稱", value: "例：學生代表補選" },
      { label: "投票日期", value: "例：2026/05/25" },
      { label: "投票地點", value: "例：線上投票系統" },
    ],
    ctaLabel: "查看選舉資訊",
  },
  {
    key: "budget",
    label: "預算狀態變更",
    heading: "預算狀態變更通知",
    rows: [
      { label: "案件名稱", value: "例：社團活動補助案" },
      { label: "新狀態", value: "例：已核准" },
    ],
    ctaLabel: "查看案件",
  },
];

const CONFIRM_THRESHOLD = 100;
const AUTOSAVE_KEY = "email-compose";

/** 自動暫存的草稿內容（不含收件人） */
type ComposeDraft = {
  subject: string;
  heading: string;
  body: string;
  cardRows: EmailCardRow[];
  ctaLabel: string;
  ctaUrl: string;
};

function ComposeInner() {
  const router = useRouter();
  const draftId = useSearchParams().get("draft");

  const [subject, setSubject] = useState("");
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [cardRows, setCardRows] = useState<EmailCardRow[]>([]);
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [recipients, setRecipients] = useState<RecipientSelector>(EMPTY_RECIPIENTS);
  const [scheduledAt, setScheduledAt] = useState("");

  const [count, setCount] = useState<number | null>(null);
  const [sampleNames, setSampleNames] = useState<string[]>([]);
  const [previewHtml, setPreviewHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 載入草稿內容（不還原收件人，需重新選擇）
  useEffect(() => {
    if (!draftId) return;
    emailApi
      .getMessage(draftId)
      .then((m) => {
        setSubject(m.subject);
        setHeading(m.heading);
        setBody(m.body);
        setCardRows(m.card_rows);
        setCtaLabel(m.cta_label);
        setCtaUrl(m.cta_url);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入草稿失敗"));
  }, [draftId]);

  // 離開頁面或非自然關閉（關閉分頁、重新整理、切到背景）時自動暫存草稿至本機；
  // useDraftAutosave 內建 pagehide / beforeunload / visibilitychange 監聽。
  const restoreDraft = useCallback((d: ComposeDraft) => {
    setSubject(d.subject);
    setHeading(d.heading);
    setBody(d.body);
    setCardRows(d.cardRows);
    setCtaLabel(d.ctaLabel);
    setCtaUrl(d.ctaUrl);
    toast.info("已還原上次未送出的內容");
  }, []);

  const isDraftEmpty = useCallback(
    (d: ComposeDraft) =>
      !d.subject.trim() &&
      !d.heading.trim() &&
      !d.body.trim() &&
      d.cardRows.length === 0 &&
      !d.ctaLabel.trim() &&
      !d.ctaUrl.trim(),
    [],
  );

  const { clearDraft, lastSavedAt } = useDraftAutosave<ComposeDraft>({
    key: AUTOSAVE_KEY,
    value: { subject, heading, body, cardRows, ctaLabel, ctaUrl },
    enabled: !draftId,
    onRestore: restoreDraft,
    isEmpty: isDraftEmpty,
  });

  const buildPayload = useCallback(
    (): EmailComposePayload => ({
      subject: subject.trim(),
      heading: heading.trim(),
      body,
      card_rows: cardRows.filter((r) => r.label.trim() && r.value.trim()),
      cta_label: ctaLabel.trim(),
      cta_url: ctaUrl.trim(),
      recipients,
    }),
    [subject, heading, body, cardRows, ctaLabel, ctaUrl, recipients],
  );

  // 收件人預覽（debounce）
  useEffect(() => {
    const t = setTimeout(() => {
      emailApi
        .previewRecipients(recipients)
        .then((r) => {
          setCount(r.recipient_count);
          setSampleNames(r.sample_names);
        })
        .catch(() => {
          setCount(null);
          setSampleNames([]);
        });
    }, 400);
    return () => clearTimeout(t);
  }, [recipients]);

  // 信件預覽 HTML（debounce）
  useEffect(() => {
    if (!subject.trim()) {
      setPreviewHtml("");
      return;
    }
    const t = setTimeout(() => {
      emailApi
        .preview(buildPayload())
        .then((r) => setPreviewHtml(r.html))
        .catch(() => setPreviewHtml(""));
    }, 600);
    return () => clearTimeout(t);
  }, [subject, heading, body, cardRows, ctaLabel, ctaUrl, buildPayload]);

  const addRow = () => setCardRows((rows) => [...rows, { label: "", value: "" }]);
  const updateRow = (i: number, patch: Partial<EmailCardRow>) =>
    setCardRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) =>
    setCardRows((rows) => rows.filter((_, idx) => idx !== i));

  const applyPreset = (key: string) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setHeading(preset.heading);
    setCardRows(preset.rows);
    setCtaLabel(preset.ctaLabel);
  };

  const validate = (needRecipients: boolean): boolean => {
    if (!subject.trim()) {
      toast.error("請填寫信件主旨");
      return false;
    }
    if (needRecipients && !count) {
      toast.error("請選擇至少一位有效收件人");
      return false;
    }
    return true;
  };

  const handleTest = async () => {
    if (!validate(false)) return;
    setBusy(true);
    try {
      const res = await emailApi.test(buildPayload());
      toast.success(`測試信已寄出至 ${res.sent_to}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "測試寄送失敗");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!validate(false)) return;
    setBusy(true);
    try {
      await emailApi.createMessage({ ...buildPayload(), action: "draft" });
      clearDraft();
      toast.success("草稿已儲存");
      router.push("/email/logs");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "儲存草稿失敗");
    } finally {
      setBusy(false);
    }
  };

  const handleSchedule = async () => {
    if (!validate(true)) return;
    if (!scheduledAt) {
      toast.error("請選擇預約寄送時間");
      return;
    }
    setBusy(true);
    try {
      await emailApi.createMessage({
        ...buildPayload(),
        action: "schedule",
        scheduled_at: new Date(scheduledAt).toISOString(),
      });
      clearDraft();
      toast.success("已排定預約寄送");
      router.push("/email/logs");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "預約寄送失敗");
    } finally {
      setBusy(false);
    }
  };

  const doSend = async () => {
    setConfirmOpen(false);
    setBusy(true);
    try {
      await emailApi.createMessage({ ...buildPayload(), action: "send" });
      clearDraft();
      toast.success("信件已排入寄送佇列");
      router.push("/email/logs");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "寄送失敗");
    } finally {
      setBusy(false);
    }
  };

  const handleSend = () => {
    if (!validate(true)) return;
    if ((count ?? 0) > CONFIRM_THRESHOLD) {
      setConfirmOpen(true);
      return;
    }
    void doSend();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
          EMAIL
        </p>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">寄送電子郵件</h1>
          <Link href="/email/logs" className="btn btn-ghost btn-sm">
            寄信紀錄
          </Link>
        </div>
        {draftId && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            已載入草稿內容；收件人請重新選擇。
          </p>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── 編輯區 ─────────────────────────────────────────── */}
        <div className="space-y-4">
          <section className="card space-y-3 p-4">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                情境預設
              </label>
              <select
                className="input"
                defaultValue=""
                onChange={(e) => {
                  applyPreset(e.target.value);
                  e.currentTarget.value = "";
                }}
              >
                <option value="" disabled>
                  選擇情境以快速套用版型…
                </option>
                {PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                信件主旨 <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                className="input"
                value={subject}
                maxLength={255}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="例：第 75 屆第 3 次院會通知"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                主標題
              </label>
              <input
                className="input"
                value={heading}
                maxLength={200}
                onChange={(e) => setHeading(e.target.value)}
                placeholder="顯示於信件內容最上方的大標題"
              />
            </div>
          </section>

          <section className="card space-y-2 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">重點卡片</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addRow}>
                + 新增欄位
              </button>
            </div>
            {cardRows.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                可加入「時間 / 地點 / 狀態」等重點欄位，會以卡片樣式呈現。
              </p>
            ) : (
              cardRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="input flex-[2]"
                    value={row.label}
                    maxLength={50}
                    placeholder="欄位名稱"
                    onChange={(e) => updateRow(i, { label: e.target.value })}
                  />
                  <input
                    className="input flex-[3]"
                    value={row.value}
                    maxLength={200}
                    placeholder="內容"
                    onChange={(e) => updateRow(i, { value: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label="移除欄位"
                    onClick={() => removeRow(i)}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </section>

          <section className="card space-y-2 p-4">
            <h2 className="text-sm font-semibold">內文</h2>
            <RichTextarea value={body} onChange={setBody} placeholder="撰寫信件內文…" />
          </section>

          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold">行動按鈕（選填）</h2>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={ctaLabel}
                maxLength={40}
                placeholder="按鈕文字，例：查看詳情"
                onChange={(e) => setCtaLabel(e.target.value)}
              />
              <input
                className="input flex-[2]"
                value={ctaUrl}
                maxLength={500}
                placeholder="連結網址 https://…"
                onChange={(e) => setCtaUrl(e.target.value)}
              />
            </div>
          </section>

          <section className="card space-y-2 p-4">
            <h2 className="text-sm font-semibold">收件對象</h2>
            <RecipientPicker onChange={setRecipients} disabled={busy} />
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {count === null
                ? "尚未選擇收件人"
                : `預計寄送 ${count} 人`}
              {sampleNames.length > 0 && `（${sampleNames.join("、")}${count && count > sampleNames.length ? " …" : ""}）`}
            </p>
          </section>
        </div>

        {/* ── 預覽與動作 ─────────────────────────────────────── */}
        <div className="space-y-4">
          <section className="card overflow-hidden p-0">
            <div
              className="px-4 py-2 text-sm font-semibold"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              信件預覽
            </div>
            {previewHtml ? (
              <iframe
                title="信件預覽"
                srcDoc={previewHtml}
                sandbox=""
                className="h-[520px] w-full"
                style={{ background: "#fff" }}
              />
            ) : (
              <div
                className="flex h-[520px] items-center justify-center text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                填寫主旨後即可預覽
              </div>
            )}
          </section>

          <section className="card space-y-3 p-4">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                預約寄送時間（選填）
              </label>
              <input
                type="datetime-local"
                className="input"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={handleTest}
              >
                測試寄給我
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={handleSaveDraft}
              >
                儲存草稿
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || !scheduledAt}
                onClick={handleSchedule}
              >
                預約寄送
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={handleSend}
              >
                立即寄送
              </button>
            </div>
            {lastSavedAt && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                ✓ 內容已自動暫存於本機，重新整理或關閉分頁也不會遺失
              </p>
            )}
          </section>
        </div>
      </div>

      {confirmOpen && (
        <Modal title="確認大量寄送" onClose={() => setConfirmOpen(false)} maxWidthClassName="max-w-md">
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            這封信將寄送給 <strong>{count}</strong> 位收件人，確定要立即送出嗎？
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={doSend}>
              確認寄送
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function EmailComposePage() {
  return (
    <Suspense fallback={null}>
      <ComposeInner />
    </Suspense>
  );
}
