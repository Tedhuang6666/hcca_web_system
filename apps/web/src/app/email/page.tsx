"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import Modal from "@/components/ui/Modal";
import RichTextarea, { type RichTextareaHandle } from "@/components/ui/RichTextarea";
import RecipientPicker from "@/components/email/RecipientPicker";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";
import { ApiError, emailApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import type {
  EmailBlock,
  EmailButton,
  EmailButtonStyle,
  EmailCardRow,
  EmailComposePayload,
  EmailRecipientVariableInput,
  EmailVariableDefinition,
  RecipientSelector,
} from "@/lib/types";

const EMPTY_RECIPIENTS: RecipientSelector = {
  user_ids: [],
  position_ids: [],
  org_ids: [],
  external_emails: [],
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
  // 注意：ctaLabel 會在套用時轉成一顆主要按鈕（網址留空待填）。
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
const TEMPLATE_KEY = "email-templates";

const BUTTON_STYLE_OPTIONS: { value: EmailButtonStyle; label: string }[] = [
  { value: "primary", label: "主要（深色）" },
  { value: "secondary", label: "次要（金色）" },
  { value: "outline", label: "外框" },
];

/** 逐收件人指定不同內容的一列（表格編輯，取代手寫 JSON） */
type RecipientRow = { email: string; name: string; variables: Record<string, string> };

/** 系統內建可用變數（一律可插入） */
const SYSTEM_VARIABLES: { token: string; label: string }[] = [
  { token: "{{ user.name }}", label: "收件人姓名" },
  { token: "{{ user.email }}", label: "收件人 Email" },
  { token: "{{ unsubscribe_url }}", label: "退訂連結" },
];

/** 自動暫存的草稿內容（不含收件人） */
type ComposeDraft = {
  subject: string;
  heading: string;
  bannerImageUrl: string;
  bannerImageAlt: string;
  body: string;
  cardRows: EmailCardRow[];
  buttons: EmailButton[];
  blocks: EmailBlock[];
  variableDefinitions: EmailVariableDefinition[];
  previewVariables: Record<string, string>;
  recipientRows: RecipientRow[];
};

type TemplateContent = Omit<ComposeDraft, "recipientRows">;

type SavedTemplate = TemplateContent & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

function ComposeInner() {
  const router = useRouter();
  const draftId = useSearchParams().get("draft");

  const [subject, setSubject] = useState("");
  const [heading, setHeading] = useState("");
  const [bannerImageUrl, setBannerImageUrl] = useState("");
  const [bannerImageAlt, setBannerImageAlt] = useState("");
  const [body, setBody] = useState("");
  const [cardRows, setCardRows] = useState<EmailCardRow[]>([]);
  const [buttons, setButtons] = useState<EmailButton[]>([]);
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [variableDefinitions, setVariableDefinitions] = useState<EmailVariableDefinition[]>([]);
  const [previewVariables, setPreviewVariables] = useState<Record<string, string>>({});
  const [recipientRows, setRecipientRows] = useState<RecipientRow[]>([]);
  const [showPerRecipient, setShowPerRecipient] = useState(false);
  const [recipients, setRecipients] = useState<RecipientSelector>(EMPTY_RECIPIENTS);

  // 「插入變數」用：記住最後聚焦的文字欄位，將 {{ key }} 插入游標處
  const subjectRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<RichTextareaHandle>(null);
  const lastFocusRef = useRef<"subject" | "heading" | "body">("body");
  const [scheduledAt, setScheduledAt] = useState("");

  const [count, setCount] = useState<number | null>(null);
  const [sampleNames, setSampleNames] = useState<string[]>([]);
  const [previewHtml, setPreviewHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TEMPLATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedTemplate[];
      if (Array.isArray(parsed)) setSavedTemplates(parsed);
    } catch {
      setSavedTemplates([]);
    }
  }, []);

  const persistTemplates = useCallback((rows: SavedTemplate[]) => {
    setSavedTemplates(rows);
    window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(rows));
  }, []);

  // 載入草稿內容（不還原收件人，需重新選擇）
  useEffect(() => {
    if (!draftId) return;
    emailApi
      .getMessage(draftId)
      .then((m) => {
        setSubject(m.subject);
        setHeading(m.heading);
        setBannerImageUrl(m.banner_image_url ?? "");
        setBannerImageAlt(m.banner_image_alt ?? "");
        setBody(m.body);
        setCardRows(m.card_rows);
        // 舊草稿可能只有單一 CTA，無 buttons：自動轉成一顆主要按鈕。
        if (m.buttons && m.buttons.length > 0) {
          setButtons(m.buttons);
        } else if (m.cta_url || m.cta_label) {
          setButtons([{ label: m.cta_label, url: m.cta_url, style: "primary" }]);
        } else {
          setButtons([]);
        }
        setBlocks(m.blocks ?? []);
        setVariableDefinitions(m.variable_definitions);
        const rows = (m.recipient_variables ?? []).map((r) => ({
          email: r.email ?? "",
          name: r.name ?? "",
          variables: { ...(r.variables ?? {}) },
        }));
        setRecipientRows(rows);
        setShowPerRecipient(rows.length > 0);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入草稿失敗"));
  }, [draftId]);

  // 離開頁面或非自然關閉（關閉分頁、重新整理、切到背景）時自動暫存草稿至本機；
  // useDraftAutosave 內建 pagehide / beforeunload / visibilitychange 監聽。
  const restoreDraft = useCallback((d: ComposeDraft) => {
    setSubject(d.subject);
    setHeading(d.heading);
    setBannerImageUrl(d.bannerImageUrl ?? "");
    setBannerImageAlt(d.bannerImageAlt ?? "");
    setBody(d.body);
    setCardRows(d.cardRows);
    setButtons(d.buttons ?? []);
    setBlocks(d.blocks ?? []);
    setVariableDefinitions(d.variableDefinitions);
    setPreviewVariables(d.previewVariables);
    setRecipientRows(d.recipientRows ?? []);
    setShowPerRecipient((d.recipientRows?.length ?? 0) > 0);
    toast.info("已還原上次未送出的內容");
  }, []);

  const isDraftEmpty = useCallback(
    (d: ComposeDraft) =>
      !d.subject.trim() &&
      !d.heading.trim() &&
      !d.bannerImageUrl.trim() &&
      !d.bannerImageAlt.trim() &&
      !d.body.trim() &&
      d.cardRows.length === 0 &&
      (d.buttons?.length ?? 0) === 0 &&
      (d.blocks?.length ?? 0) === 0 &&
      d.variableDefinitions.length === 0 &&
      (d.recipientRows?.length ?? 0) === 0,
    [],
  );

  const { clearDraft, lastSavedAt } = useDraftAutosave<ComposeDraft>({
    key: AUTOSAVE_KEY,
    value: {
      subject,
      heading,
      bannerImageUrl,
      bannerImageAlt,
      body,
      cardRows,
      buttons,
      blocks,
      variableDefinitions,
      previewVariables,
      recipientRows,
    },
    enabled: !draftId,
    onRestore: restoreDraft,
    isEmpty: isDraftEmpty,
  });

  const buildTemplateContent = useCallback(
    (): TemplateContent => ({
      subject,
      heading,
      bannerImageUrl,
      bannerImageAlt,
      body,
      cardRows,
      buttons,
      blocks,
      variableDefinitions,
      previewVariables,
    }),
    [
      subject,
      heading,
      bannerImageUrl,
      bannerImageAlt,
      body,
      cardRows,
      buttons,
      blocks,
      variableDefinitions,
      previewVariables,
    ],
  );

  const buildRecipientVariables = useCallback((): EmailRecipientVariableInput[] => {
    const allowed = new Set(
      variableDefinitions.map((v) => v.key.trim()).filter(Boolean),
    );
    // 沒有任何自訂變數時，逐收件人表格在 UI 也是隱藏的；
    // 不送出殘留列，避免無意間多塞收件人。
    if (allowed.size === 0) return [];
    return recipientRows
      .filter((r) => r.email.trim())
      .map((r) => ({
        email: r.email.trim(),
        name: r.name.trim() || null,
        variables: Object.fromEntries(
          Object.entries(r.variables).filter(([k]) => allowed.has(k)),
        ),
      }));
  }, [recipientRows, variableDefinitions]);

  const buildPayload = useCallback(
    (): EmailComposePayload => ({
      subject: subject.trim(),
      heading: heading.trim(),
      banner_image_url: bannerImageUrl.trim(),
      banner_image_alt: bannerImageAlt.trim(),
      body,
      card_rows: cardRows.filter((r) => r.label.trim() && r.value.trim()),
      cta_label: "",
      cta_url: "",
      buttons: buttons
        .filter((b) => b.url.trim())
        .map((b) => ({ label: b.label.trim(), url: b.url.trim(), style: b.style })),
      blocks: blocks.filter(
        (b) =>
          b.type === "divider" ||
          (b.type === "image" && (b.url ?? "").trim()) ||
          (b.type === "text" && (b.md ?? "").trim()),
      ),
      recipients,
      variable_definitions: variableDefinitions.filter((v) => v.key.trim()),
      preview_variables: previewVariables,
      recipient_variables: buildRecipientVariables(),
    }),
    [
      subject,
      heading,
      bannerImageUrl,
      bannerImageAlt,
      body,
      cardRows,
      buttons,
      blocks,
      recipients,
      variableDefinitions,
      previewVariables,
      buildRecipientVariables,
    ],
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
  }, [subject, heading, bannerImageUrl, bannerImageAlt, body, cardRows, buttons, blocks, buildPayload]);

  const addRow = () => setCardRows((rows) => [...rows, { label: "", value: "" }]);
  const updateRow = (i: number, patch: Partial<EmailCardRow>) =>
    setCardRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) =>
    setCardRows((rows) => rows.filter((_, idx) => idx !== i));

  const addVariable = () =>
    setVariableDefinitions((rows) => [
      ...rows,
      { key: "", label: "", required: false, default_value: "" },
    ]);
  const updateVariable = (i: number, patch: Partial<EmailVariableDefinition>) =>
    setVariableDefinitions((rows) =>
      rows.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  const removeVariable = (i: number) => {
    const key = variableDefinitions[i]?.key;
    setVariableDefinitions((rows) => rows.filter((_, idx) => idx !== i));
    if (key) {
      setPreviewVariables((vars) => {
        const next = { ...vars };
        delete next[key];
        return next;
      });
    }
  };

  const applyPreset = (key: string) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setHeading(preset.heading);
    setCardRows(preset.rows);
    // 套用情境時保留既有按鈕網址（若有），只在尚無按鈕時放一顆主要按鈕。
    setButtons((prev) =>
      prev.length > 0 ? prev : [{ label: preset.ctaLabel, url: "", style: "primary" }],
    );
  };

  const applyTemplate = (template: SavedTemplate) => {
    setSubject(template.subject);
    setHeading(template.heading);
    setBannerImageUrl(template.bannerImageUrl);
    setBannerImageAlt(template.bannerImageAlt);
    setBody(template.body);
    setCardRows(template.cardRows);
    setButtons(template.buttons);
    setBlocks(template.blocks);
    setVariableDefinitions(template.variableDefinitions);
    setPreviewVariables(template.previewVariables);
    setRecipientRows([]);
    setShowPerRecipient(false);
    toast.success(`已套用範本：${template.name}`);
  };

  const handleApplyTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const template = savedTemplates.find((row) => row.id === id);
    if (template) applyTemplate(template);
  };

  const handleSaveTemplate = () => {
    const fallbackName = subject.trim() || heading.trim() || "未命名範本";
    const name = window.prompt("範本名稱", fallbackName)?.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const template: SavedTemplate = {
      ...buildTemplateContent(),
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
    };
    persistTemplates([template, ...savedTemplates]);
    setSelectedTemplateId(template.id);
    toast.success("範本已儲存");
  };

  const handleDeleteTemplate = () => {
    if (!selectedTemplateId) return;
    const next = savedTemplates.filter((row) => row.id !== selectedTemplateId);
    persistTemplates(next);
    setSelectedTemplateId("");
    toast.success("範本已刪除");
  };

  // ── 行動按鈕（可多顆、可調樣式）────────────────────────────────────────────
  const addButton = () =>
    setButtons((prev) => [...prev, { label: "查看詳情", url: "", style: "primary" }]);
  const updateButton = (i: number, patch: Partial<EmailButton>) =>
    setButtons((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const removeButton = (i: number) => setButtons((prev) => prev.filter((_, idx) => idx !== i));
  const moveButton = (i: number, dir: -1 | 1) =>
    setButtons((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // ── 自由內容區塊（文字 / 圖片 / 分隔線）────────────────────────────────────
  const addBlock = (type: EmailBlock["type"]) =>
    setBlocks((prev) => [...prev, { type, md: "", url: "", alt: "" }]);
  const updateBlock = (i: number, patch: Partial<EmailBlock>) =>
    setBlocks((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const removeBlock = (i: number) => setBlocks((prev) => prev.filter((_, idx) => idx !== i));
  const moveBlock = (i: number, dir: -1 | 1) =>
    setBlocks((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const uploadBlockImage = async (i: number, file: File) => {
    setUploadingImage(true);
    try {
      const result = await emailApi.uploadImage(file);
      updateBlock(i, { url: result.url });
      toast.success("圖片已上傳");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "圖片上傳失敗");
    } finally {
      setUploadingImage(false);
    }
  };
  const uploadBannerImage = async (file: File) => {
    setUploadingImage(true);
    try {
      const result = await emailApi.uploadImage(file);
      setBannerImageUrl(result.url);
      if (!bannerImageAlt.trim()) setBannerImageAlt(result.filename);
      toast.success("主圖已上傳");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "主圖上傳失敗");
    } finally {
      setUploadingImage(false);
    }
  };

  // ── 個人化變數 ─────────────────────────────────────────────────────────────
  const definedVariables = variableDefinitions.filter((v) => v.key.trim());

  /** 把 {{ token }} 插入最後聚焦的欄位（主旨/主標題游標處，否則插入內文）。 */
  const insertVariable = (token: string) => {
    const target = lastFocusRef.current;
    if (target === "subject" || target === "heading") {
      const el = target === "subject" ? subjectRef.current : headingRef.current;
      const setter = target === "subject" ? setSubject : setHeading;
      if (el) {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        setter(el.value.slice(0, start) + token + el.value.slice(end));
        requestAnimationFrame(() => {
          el.focus();
          const pos = start + token.length;
          el.setSelectionRange(pos, pos);
        });
        return;
      }
    }
    bodyRef.current?.insertText(token);
  };

  const addVariableDefinition = () => {
    addVariable();
    if (recipientRows.length > 0) setShowPerRecipient(true);
  };

  // ── 逐收件人不同內容（表格編輯）──────────────────────────────────────────────
  const addRecipientRow = () =>
    setRecipientRows((prev) => [...prev, { email: "", name: "", variables: {} }]);
  const updateRecipientRow = (i: number, patch: Partial<RecipientRow>) =>
    setRecipientRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const updateRecipientVar = (i: number, key: string, value: string) =>
    setRecipientRows((prev) =>
      prev.map((r, idx) =>
        idx === i ? { ...r, variables: { ...r.variables, [key]: value } } : r,
      ),
    );
  const removeRecipientRow = (i: number) =>
    setRecipientRows((prev) => prev.filter((_, idx) => idx !== i));

  const validate = (needRecipients: boolean): boolean => {
    if (!subject.trim()) {
      toast.error("請填寫信件主旨");
      return false;
    }
    const importedRecipients = buildRecipientVariables();
    if (needRecipients && !count && !importedRecipients.some((row) => row.email?.trim())) {
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
            <div className="space-y-2">
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                我的範本
              </label>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <select
                  className="input min-w-0"
                  value={selectedTemplateId}
                  onChange={(e) => handleApplyTemplate(e.target.value)}
                >
                  <option value="">選擇已儲存範本…</option>
                  {savedTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleSaveTemplate}>
                  儲存目前內容
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!selectedTemplateId}
                  onClick={handleDeleteTemplate}
                >
                  刪除
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                信件主旨 <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                ref={subjectRef}
                className="input"
                value={subject}
                maxLength={255}
                onFocus={() => (lastFocusRef.current = "subject")}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="例：第 75 屆第 3 次院會通知"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                主標題
              </label>
              <input
                ref={headingRef}
                className="input"
                value={heading}
                maxLength={200}
                onFocus={() => (lastFocusRef.current = "heading")}
                onChange={(e) => setHeading(e.target.value)}
                placeholder="顯示於信件內容最上方的大標題"
              />
            </div>
            <div className="space-y-2">
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                信件主圖
              </label>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  value={bannerImageUrl}
                  maxLength={500}
                  onChange={(e) => setBannerImageUrl(e.target.value)}
                  placeholder="圖片網址，或點右側上傳"
                />
                <label className={`btn btn-secondary btn-sm shrink-0 ${uploadingImage ? "cursor-wait opacity-70" : "cursor-pointer"}`}>
                  {uploadingImage ? "上傳中…" : "上傳"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="hidden"
                    disabled={uploadingImage}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadBannerImage(file);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              <input
                className="input"
                value={bannerImageAlt}
                maxLength={200}
                onChange={(e) => setBannerImageAlt(e.target.value)}
                placeholder="圖片替代文字（選填）"
              />
              {bannerImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={uploadUrl(bannerImageUrl)} alt={bannerImageAlt || "信件主圖預覽"} className="max-h-40 rounded-lg object-contain" />
              ) : null}
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
            <div onFocus={() => (lastFocusRef.current = "body")}>
              <RichTextarea ref={bodyRef} value={body} onChange={setBody} placeholder="撰寫信件內文…" />
            </div>
          </section>

          <section className="card space-y-3 p-4">
            <div>
              <h2 className="text-sm font-semibold">個人化變數</h2>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                先把游標點進「主旨／主標題／內文」，再點下方標籤即可插入；寄出時會自動換成每位收件人的實際內容。
              </p>
            </div>

            {/* 可插入的變數標籤 */}
            <div className="flex flex-wrap gap-1.5">
              {SYSTEM_VARIABLES.map((v) => (
                <button
                  key={v.token}
                  type="button"
                  onClick={() => insertVariable(v.token)}
                  className="rounded-full px-2.5 py-1 text-xs"
                  style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border)" }}
                  title={`插入 ${v.token}`}
                >
                  + {v.label}
                </button>
              ))}
              {definedVariables.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insertVariable(`{{ ${v.key} }}`)}
                  className="rounded-full px-2.5 py-1 text-xs"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                  title={`插入 {{ ${v.key} }}`}
                >
                  + {v.label || v.key}
                </button>
              ))}
            </div>

            {/* 自訂變數定義 */}
            <div className="space-y-2 rounded-lg p-3" style={{ background: "var(--bg-elevated)" }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                  自訂變數
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addVariableDefinition}>
                  + 新增自訂變數
                </button>
              </div>
              {variableDefinitions.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  需要每位收件人不同的內容（例如面試時間、座號）時，在此新增一個自訂變數。
                </p>
              ) : (
                <>
                  <div className="hidden gap-2 px-1 text-[11px] md:grid md:grid-cols-[1.3fr_1.3fr_1.4fr_auto_auto]" style={{ color: "var(--text-muted)" }}>
                    <span>名稱（顯示用）</span>
                    <span>代號（英數，插入用）</span>
                    <span>預設 / 預覽值</span>
                    <span>必填</span>
                    <span />
                  </div>
                  {variableDefinitions.map((row, i) => (
                    <div key={i} className="grid gap-2 md:grid-cols-[1.3fr_1.3fr_1.4fr_auto_auto]">
                      <input
                        className="input"
                        value={row.label}
                        maxLength={80}
                        placeholder="例：面試時間"
                        onChange={(e) => updateVariable(i, { label: e.target.value })}
                      />
                      <input
                        className="input font-mono text-xs"
                        value={row.key}
                        maxLength={64}
                        placeholder="interview_time"
                        onChange={(e) =>
                          updateVariable(i, {
                            key: e.target.value.replace(/[^A-Za-z0-9_]/g, ""),
                          })
                        }
                      />
                      <input
                        className="input"
                        value={previewVariables[row.key] ?? row.default_value}
                        maxLength={500}
                        placeholder="預設值（未逐一指定時使用）"
                        onChange={(e) => {
                          updateVariable(i, { default_value: e.target.value });
                          if (row.key) {
                            setPreviewVariables((vars) => ({ ...vars, [row.key]: e.target.value }));
                          }
                        }}
                      />
                      <label className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                        <input
                          type="checkbox"
                          checked={row.required}
                          onChange={(e) => updateVariable(i, { required: e.target.checked })}
                        />
                        必填
                      </label>
                      <button type="button" className="btn btn-ghost btn-sm" aria-label="移除變數" onClick={() => removeVariable(i)}>
                        ×
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* 逐收件人不同內容（取代手寫 JSON） */}
            {definedVariables.length > 0 && (
              <div className="space-y-2">
                <button
                  type="button"
                  className="text-xs font-medium underline"
                  style={{ color: "var(--primary)" }}
                  onClick={() => setShowPerRecipient((v) => !v)}
                >
                  {showPerRecipient ? "▾ " : "▸ "}進階：為不同收件人填入不同內容（選填）
                </button>
                {showPerRecipient && (
                  <div className="space-y-2 rounded-lg p-3" style={{ background: "var(--bg-elevated)" }}>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      在此指定特定 Email 的變數值；未列出的收件人會用上方的「預設值」。
                    </p>
                    <div className="space-y-2">
                      {recipientRows.map((row, i) => (
                        <div key={i} className="space-y-1.5 rounded-lg p-2" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                          <div className="flex gap-2">
                            <input
                              className="input flex-[2]"
                              value={row.email}
                              placeholder="收件人 Email"
                              onChange={(e) => updateRecipientRow(i, { email: e.target.value })}
                            />
                            <input
                              className="input flex-1"
                              value={row.name}
                              placeholder="姓名（選填）"
                              onChange={(e) => updateRecipientRow(i, { name: e.target.value })}
                            />
                            <button type="button" className="btn btn-ghost btn-sm" aria-label="移除此收件人" onClick={() => removeRecipientRow(i)}>
                              ×
                            </button>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {definedVariables.map((v) => (
                              <label key={v.key} className="text-xs" style={{ color: "var(--text-muted)" }}>
                                {v.label || v.key}
                                <input
                                  className="input mt-0.5"
                                  value={row.variables[v.key] ?? ""}
                                  placeholder={previewVariables[v.key] ?? v.default_value ?? ""}
                                  onChange={(e) => updateRecipientVar(i, v.key, e.target.value)}
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={addRecipientRow}>
                      + 新增一位收件人
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">行動按鈕（選填，可多顆）</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addButton}>
                + 新增按鈕
              </button>
            </div>
            {buttons.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                可加入一顆以上的按鈕（例如「前往簽到」「查看附件」），並各自選擇樣式。
              </p>
            ) : (
              buttons.map((btn, i) => (
                <div key={i} className="space-y-2 rounded-lg p-2" style={{ background: "var(--bg-elevated)" }}>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <input
                      className="input min-w-0"
                      value={btn.label}
                      maxLength={40}
                      placeholder="按鈕文字，例：查看詳情"
                      onChange={(e) => updateButton(i, { label: e.target.value })}
                    />
                    <select
                      className="input w-32 shrink-0"
                      value={btn.style}
                      onChange={(e) => updateButton(i, { style: e.target.value as EmailButtonStyle })}
                    >
                      {BUTTON_STYLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      className="input min-w-0"
                      value={btn.url}
                      maxLength={500}
                      placeholder="連結網址 https://… 或 mailto:"
                      onChange={(e) => updateButton(i, { url: e.target.value })}
                    />
                    <div className="flex gap-1">
                      <button type="button" className="btn btn-ghost btn-sm" aria-label="上移" disabled={i === 0} onClick={() => moveButton(i, -1)}>↑</button>
                      <button type="button" className="btn btn-ghost btn-sm" aria-label="下移" disabled={i === buttons.length - 1} onClick={() => moveButton(i, 1)}>↓</button>
                      <button type="button" className="btn btn-ghost btn-sm" aria-label="移除按鈕" onClick={() => removeButton(i)}>×</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">內容區塊（選填）</h2>
              <div className="flex gap-1.5">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => addBlock("text")}>+ 文字</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => addBlock("image")}>+ 圖片</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => addBlock("divider")}>+ 分隔線</button>
              </div>
            </div>
            {blocks.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                在內文之後加入額外段落、圖片或分隔線，依排列順序呈現，打造更完整的版面。
              </p>
            ) : (
              blocks.map((blk, i) => (
                <div key={i} className="space-y-2 rounded-lg p-2" style={{ background: "var(--bg-elevated)" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                      {blk.type === "text" ? "文字段落" : blk.type === "image" ? "圖片" : "分隔線"}
                    </span>
                    <div className="flex gap-1">
                      <button type="button" className="btn btn-ghost btn-sm" aria-label="上移" disabled={i === 0} onClick={() => moveBlock(i, -1)}>↑</button>
                      <button type="button" className="btn btn-ghost btn-sm" aria-label="下移" disabled={i === blocks.length - 1} onClick={() => moveBlock(i, 1)}>↓</button>
                      <button type="button" className="btn btn-ghost btn-sm" aria-label="移除區塊" onClick={() => removeBlock(i)}>×</button>
                    </div>
                  </div>
                  {blk.type === "text" && (
                    <textarea
                      className="input min-h-20"
                      value={blk.md ?? ""}
                      maxLength={5000}
                      placeholder="支援 Markdown（粗體、清單、連結…）"
                      onChange={(e) => updateBlock(i, { md: e.target.value })}
                    />
                  )}
                  {blk.type === "image" && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          className="input flex-1"
                          value={blk.url ?? ""}
                          maxLength={500}
                          placeholder="圖片網址，或點右側上傳"
                          onChange={(e) => updateBlock(i, { url: e.target.value })}
                        />
                        <label className={`btn btn-secondary btn-sm shrink-0 ${uploadingImage ? "cursor-wait opacity-70" : "cursor-pointer"}`}>
                          {uploadingImage ? "上傳中…" : "上傳"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/gif,image/webp"
                            className="hidden"
                            disabled={uploadingImage}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadBlockImage(i, file);
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                      </div>
                      <input
                        className="input"
                        value={blk.alt ?? ""}
                        maxLength={200}
                        placeholder="圖片替代文字（無障礙用）"
                        onChange={(e) => updateBlock(i, { alt: e.target.value })}
                      />
                      {blk.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={uploadUrl(blk.url)} alt={blk.alt || "圖片預覽"} className="max-h-32 rounded-lg object-contain" />
                      ) : null}
                    </div>
                  )}
                  {blk.type === "divider" && (
                    <div className="border-t" style={{ borderColor: "var(--border-strong)" }} />
                  )}
                </div>
              ))
            )}
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
