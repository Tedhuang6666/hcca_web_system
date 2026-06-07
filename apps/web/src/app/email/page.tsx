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
  EmailAttachmentOut,
  EmailMessageOut,
  EmailPreflightOut,
  EmailRecipientListOut,
  EmailRecipientVariableInput,
  EmailTemplateOut,
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

const COMPOSE_STEPS = [
  { number: 1, label: "選擇起點", description: "空白、範本或過去郵件" },
  { number: 2, label: "收件資料", description: "建立名單與個人化欄位" },
  { number: 3, label: "郵件內容", description: "編輯並即時預覽" },
  { number: 4, label: "寄送檢查", description: "預檢與抽樣測試" },
  { number: 5, label: "確認寄送", description: "立即或預約寄送" },
] as const;

/** 逐收件人指定不同內容的一列（表格編輯，取代手寫 JSON） */
type RecipientRow = { email: string; name: string; variables: Record<string, string> };

/** 系統內建可用變數（一律可插入） */
const SYSTEM_VARIABLES: { token: string; label: string }[] = [
  { token: "{{ 姓名 }}", label: "姓名" },
  { token: "{{ 電子郵件 }}", label: "電子郵件" },
  { token: "{{ unsubscribe_url }}", label: "退訂連結" },
];

const normalizeVariableKey = (rawName: string) =>
  rawName
    .trimStart()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .replace(/^\p{N}+/u, "")
    .slice(0, 64);

/** 自動暫存的草稿內容（不含收件人） */
type ComposeDraft = {
  subject: string;
  heading: string;
  previewText: string;
  accentColor: string;
  backgroundColor: string;
  contentBackgroundColor: string;
  bodyLineHeight: number;
  paragraphSpacing: number;
  footerText: string;
  showSystemFooter: boolean;
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
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draft");
  const [activeDraftId, setActiveDraftId] = useState<string | null>(draftId);
  const requestedTemplateId = searchParams.get("template");
  const requestedListId = searchParams.get("list");

  const [subject, setSubject] = useState("");
  const [currentStep, setCurrentStep] = useState(1);
  const [heading, setHeading] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [accentColor, setAccentColor] = useState("#111827");
  const [backgroundColor, setBackgroundColor] = useState("#eef2f7");
  const [contentBackgroundColor, setContentBackgroundColor] = useState("#ffffff");
  const [bodyLineHeight, setBodyLineHeight] = useState(1.6);
  const [paragraphSpacing, setParagraphSpacing] = useState(18);
  const [footerText, setFooterText] = useState("");
  const [showSystemFooter, setShowSystemFooter] = useState(true);
  const [bannerImageUrl, setBannerImageUrl] = useState("");
  const [bannerImageAlt, setBannerImageAlt] = useState("");
  const [body, setBody] = useState("");
  const [cardRows, setCardRows] = useState<EmailCardRow[]>([]);
  const [buttons, setButtons] = useState<EmailButton[]>([]);
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [variableDefinitions, setVariableDefinitions] = useState<EmailVariableDefinition[]>([]);
  const [previewVariables, setPreviewVariables] = useState<Record<string, string>>({});
  const [recipientRows, setRecipientRows] = useState<RecipientRow[]>([
    { email: "", name: "", variables: {} },
  ]);
  const [pasteTableOpen, setPasteTableOpen] = useState(false);
  const [pasteTableText, setPasteTableText] = useState("");
  const [previewRecipientIndex, setPreviewRecipientIndex] = useState(0);
  const [recipients, setRecipients] = useState<RecipientSelector>(EMPTY_RECIPIENTS);

  // 「插入變數」用：記住最後聚焦的文字欄位，將 {{ key }} 插入游標處
  const subjectRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<RichTextareaHandle>(null);
  const recipientTableBottomRef = useRef<HTMLDivElement>(null);
  const lastFocusRef = useRef<"subject" | "heading" | "body">("body");
  const [scheduledAt, setScheduledAt] = useState("");

  const [count, setCount] = useState<number | null>(null);
  const [sampleNames, setSampleNames] = useState<string[]>([]);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [platformTemplates, setPlatformTemplates] = useState<EmailTemplateOut[]>([]);
  const [recentMessages, setRecentMessages] = useState<EmailMessageOut[]>([]);
  const [draftMessages, setDraftMessages] = useState<EmailMessageOut[]>([]);
  const [recentMessageId, setRecentMessageId] = useState("");
  const [recipientLists, setRecipientLists] = useState<EmailRecipientListOut[]>([]);
  const [platformTemplateId, setPlatformTemplateId] = useState("");
  const [recipientListId, setRecipientListId] = useState("");
  const [attachments, setAttachments] = useState<EmailAttachmentOut[]>([]);
  const [retainedAttachmentIds, setRetainedAttachmentIds] = useState<string[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [trackOpens, setTrackOpens] = useState(true);
  const [trackClicks, setTrackClicks] = useState(true);
  const [preflightResult, setPreflightResult] = useState<EmailPreflightOut | null>(null);

  const loadPlatformResources = useCallback(() => {
    Promise.all([
      emailApi.listTemplates(),
      emailApi.listRecipientLists(),
      emailApi.listMessages({ limit: 30 }),
    ])
      .then(([templates, lists, messages]) => {
        setPlatformTemplates(templates);
        setRecipientLists(lists);
        setRecentMessages(messages);
      })
      .catch((e) =>
        toast.error(e instanceof ApiError ? e.message : "載入郵件資源失敗"),
      );
    emailApi
      .listDrafts()
      .then(setDraftMessages)
      .catch((e) =>
        toast.error(e instanceof ApiError ? e.message : "載入草稿失敗"),
      );
  }, []);

  useEffect(() => {
    loadPlatformResources();
  }, [loadPlatformResources]);

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

  // 載入帳號同步草稿並完整還原內容與收件資料。
  useEffect(() => {
    setActiveDraftId(draftId);
    if (!draftId) return;
    emailApi
      .getMessage(draftId)
      .then((m) => {
        setSubject(m.subject);
        setHeading(m.heading);
        setPreviewText(m.preview_text ?? "");
        setAccentColor(m.accent_color ?? "#111827");
        setBackgroundColor(m.background_color ?? "#eef2f7");
        setContentBackgroundColor(m.content_background_color ?? "#ffffff");
        setBodyLineHeight(m.body_line_height ?? 1.6);
        setParagraphSpacing(m.paragraph_spacing ?? 18);
        setFooterText(m.footer_text ?? "");
        setShowSystemFooter(m.show_system_footer ?? true);
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
        setRecipients(m.recipient_spec ?? EMPTY_RECIPIENTS);
        setRetainedAttachmentIds(m.attachment_ids ?? []);
        setVariableDefinitions(m.variable_definitions);
        const rows = (m.recipient_variables ?? []).map((r) => ({
          email: r.email ?? "",
          name: r.name ?? "",
          variables: { ...(r.variables ?? {}) },
        }));
        setRecipientRows(rows);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入草稿失敗"));
  }, [draftId]);

  // 離開頁面或非自然關閉（關閉分頁、重新整理、切到背景）時自動暫存草稿至本機；
  // useDraftAutosave 內建 pagehide / beforeunload / visibilitychange 監聽。
  const restoreDraft = useCallback((d: ComposeDraft) => {
    setSubject(d.subject);
    setHeading(d.heading);
    setPreviewText(d.previewText ?? "");
    setAccentColor(d.accentColor ?? "#111827");
    setBackgroundColor(d.backgroundColor ?? "#eef2f7");
    setContentBackgroundColor(d.contentBackgroundColor ?? "#ffffff");
    setBodyLineHeight(d.bodyLineHeight ?? 1.6);
    setParagraphSpacing(d.paragraphSpacing ?? 18);
    setFooterText(d.footerText ?? "");
    setShowSystemFooter(d.showSystemFooter ?? true);
    setBannerImageUrl(d.bannerImageUrl ?? "");
    setBannerImageAlt(d.bannerImageAlt ?? "");
    setBody(d.body);
    setCardRows(d.cardRows);
    setButtons(d.buttons ?? []);
    setBlocks(d.blocks ?? []);
    setVariableDefinitions(d.variableDefinitions);
    setPreviewVariables(d.previewVariables);
    setRecipientRows(d.recipientRows ?? []);
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
      previewText,
      accentColor,
      backgroundColor,
      contentBackgroundColor,
      bodyLineHeight,
      paragraphSpacing,
      footerText,
      showSystemFooter,
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
      previewText,
      accentColor,
      backgroundColor,
      contentBackgroundColor,
      bodyLineHeight,
      paragraphSpacing,
      footerText,
      showSystemFooter,
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
      previewText,
      accentColor,
      backgroundColor,
      contentBackgroundColor,
      bodyLineHeight,
      paragraphSpacing,
      footerText,
      showSystemFooter,
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
      preview_text: previewText.trim(),
      accent_color: accentColor,
      background_color: backgroundColor,
      content_background_color: contentBackgroundColor,
      body_line_height: bodyLineHeight,
      paragraph_spacing: paragraphSpacing,
      footer_text: footerText.trim(),
      show_system_footer: showSystemFooter,
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
      preview_variables: {
        ...previewVariables,
        ...(recipientRows[previewRecipientIndex]?.variables ?? {}),
      },
      preview_recipient: recipientRows[previewRecipientIndex]
        ? {
            email: recipientRows[previewRecipientIndex].email,
            name: recipientRows[previewRecipientIndex].name,
            variables: recipientRows[previewRecipientIndex].variables,
          }
        : null,
      recipient_variables: buildRecipientVariables(),
      template_id: platformTemplateId || null,
      recipient_list_id: recipientListId || null,
      attachment_ids: Array.from(
        new Set([...retainedAttachmentIds, ...attachments.map((item) => item.id)]),
      ),
      track_opens: trackOpens,
      track_clicks: trackClicks,
    }),
    [
      subject,
      heading,
      previewText,
      accentColor,
      backgroundColor,
      contentBackgroundColor,
      bodyLineHeight,
      paragraphSpacing,
      footerText,
      showSystemFooter,
      bannerImageUrl,
      bannerImageAlt,
      body,
      cardRows,
      buttons,
      blocks,
      recipients,
      variableDefinitions,
      previewVariables,
      recipientRows,
      previewRecipientIndex,
      platformTemplateId,
      recipientListId,
      attachments,
      retainedAttachmentIds,
      trackOpens,
      trackClicks,
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
      setPreviewError("");
      return;
    }
    const t = setTimeout(() => {
      emailApi
        .preview(buildPayload())
        .then((r) => {
          setPreviewHtml(r.html);
          setPreviewError("");
        })
        .catch((error) => {
          setPreviewHtml("");
          setPreviewError(error instanceof ApiError ? error.message : "預覽產生失敗");
        });
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
      { key: "", label: "", required: true, default_value: "" },
    ]);
  const updateVariableName = (i: number, rawName: string) => {
    const oldKey = variableDefinitions[i]?.key ?? "";
    const key = normalizeVariableKey(rawName);
    setVariableDefinitions((rows) =>
      rows.map((row, idx) => (idx === i ? { ...row, key, label: key } : row)),
    );
    if (oldKey === key) return;
    setPreviewVariables((vars) => {
      const next = { ...vars };
      if (oldKey && oldKey in next) {
        next[key] = next[oldKey];
        delete next[oldKey];
      }
      return next;
    });
    setRecipientRows((rows) =>
      rows.map((row) => {
        const variables = { ...row.variables };
        if (oldKey && oldKey in variables) {
          variables[key] = variables[oldKey];
          delete variables[oldKey];
        }
        return { ...row, variables };
      }),
    );
  };
  const removeVariable = (i: number) => {
    const key = variableDefinitions[i]?.key;
    setVariableDefinitions((rows) => rows.filter((_, idx) => idx !== i));
    if (key) {
      setPreviewVariables((vars) => {
        const next = { ...vars };
        delete next[key];
        return next;
      });
      setRecipientRows((rows) =>
        rows.map((row) => {
          const variables = { ...row.variables };
          delete variables[key];
          return { ...row, variables };
        }),
      );
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
    setPreviewText(template.previewText ?? "");
    setAccentColor(template.accentColor ?? "#111827");
    setBackgroundColor(template.backgroundColor ?? "#eef2f7");
    setContentBackgroundColor(template.contentBackgroundColor ?? "#ffffff");
    setBodyLineHeight(template.bodyLineHeight ?? 1.6);
    setParagraphSpacing(template.paragraphSpacing ?? 18);
    setFooterText(template.footerText ?? "");
    setShowSystemFooter(template.showSystemFooter ?? true);
    setBannerImageUrl(template.bannerImageUrl);
    setBannerImageAlt(template.bannerImageAlt);
    setBody(template.body);
    setCardRows(template.cardRows);
    setButtons(template.buttons);
    setBlocks(template.blocks);
    setVariableDefinitions(template.variableDefinitions);
    setPreviewVariables(template.previewVariables);
    setRecipientRows([]);
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

  const applyPlatformTemplate = (id: string) => {
    setPlatformTemplateId(id);
    const template = platformTemplates.find((item) => item.id === id);
    if (!template) return;
    const content = template.content;
    setSubject(content.subject ?? "");
    setHeading(content.heading ?? "");
    setPreviewText(content.preview_text ?? "");
    setAccentColor(content.accent_color ?? "#111827");
    setBackgroundColor(content.background_color ?? "#eef2f7");
    setContentBackgroundColor(content.content_background_color ?? "#ffffff");
    setBodyLineHeight(content.body_line_height ?? 1.6);
    setParagraphSpacing(content.paragraph_spacing ?? 18);
    setFooterText(content.footer_text ?? "");
    setShowSystemFooter(content.show_system_footer ?? true);
    setBannerImageUrl(content.banner_image_url ?? "");
    setBannerImageAlt(content.banner_image_alt ?? "");
    setBody(content.body ?? "");
    setCardRows(content.card_rows ?? []);
    setButtons(content.buttons ?? []);
    setBlocks(content.blocks ?? []);
    setVariableDefinitions(template.variable_definitions ?? []);
    setTrackOpens(content.track_opens ?? true);
    setTrackClicks(content.track_clicks ?? true);
    toast.success(`已套用平台範本：${template.name}`);
  };

  const applyRecentMessage = async (id: string) => {
    setRecentMessageId(id);
    if (!id) return;
    try {
      const message = await emailApi.getMessage(id);
      setSubject(message.subject);
      setHeading(message.heading);
      setPreviewText(message.preview_text ?? "");
      setAccentColor(message.accent_color ?? "#111827");
      setBackgroundColor(message.background_color ?? "#eef2f7");
      setContentBackgroundColor(message.content_background_color ?? "#ffffff");
      setBodyLineHeight(message.body_line_height ?? 1.6);
      setParagraphSpacing(message.paragraph_spacing ?? 18);
      setFooterText(message.footer_text ?? "");
      setShowSystemFooter(message.show_system_footer ?? true);
      setBannerImageUrl(message.banner_image_url ?? "");
      setBannerImageAlt(message.banner_image_alt ?? "");
      setBody(message.body);
      setCardRows(message.card_rows ?? []);
      setButtons(message.buttons ?? []);
      setBlocks(message.blocks ?? []);
      setVariableDefinitions(message.variable_definitions ?? []);
      setPreviewVariables(message.default_variables ?? {});
      setTrackOpens(message.track_opens);
      setTrackClicks(message.track_clicks);
      toast.success("已套用過去郵件格式，未帶入舊收件人");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "載入過去郵件失敗");
    }
  };

  const savePlatformTemplate = async () => {
    const name = window.prompt("平台範本名稱", subject || heading || "未命名範本")?.trim();
    if (!name) return;
    try {
      const template = await emailApi.createTemplate({
        name,
        visibility: "private",
        content: buildPayload(),
        variable_definitions: variableDefinitions,
      });
      setPlatformTemplates((rows) => [template, ...rows]);
      setPlatformTemplateId(template.id);
      toast.success("平台範本已儲存");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "儲存平台範本失敗");
    }
  };

  const applyRecipientList = (id: string) => {
    setRecipientListId(id);
    const list = recipientLists.find((item) => item.id === id);
    if (!list) return;
    setVariableDefinitions(list.variable_definitions ?? []);
    setRecipientRows(
      list.members.map((member) => ({
        email: member.email,
        name: member.name ?? "",
        variables: { ...member.variables },
      })),
    );
    toast.success(`已套用收件名單：${list.name}`);
  };

  useEffect(() => {
    if (requestedTemplateId && platformTemplates.length > 0 && !platformTemplateId) {
      applyPlatformTemplate(requestedTemplateId);
    }
    if (requestedListId && recipientLists.length > 0 && !recipientListId) {
      applyRecipientList(requestedListId);
    }
    // 套用 URL 指定資源只需在資源首次載入時執行。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTemplateId, requestedListId, platformTemplates, recipientLists]);

  const uploadAttachment = async (file: File) => {
    setUploadingAttachment(true);
    try {
      const attachment = await emailApi.uploadAttachment(file, platformTemplateId || undefined);
      setAttachments((rows) => [...rows, attachment]);
      toast.success(
        attachment.delivery_mode === "attachment"
          ? "附件已加入郵件"
          : "檔案較大，將以安全下載連結寄送",
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "附件上傳失敗");
    } finally {
      setUploadingAttachment(false);
    }
  };

  const removeAttachment = async (attachment: EmailAttachmentOut) => {
    try {
      await emailApi.revokeAttachment(attachment.id);
      setAttachments((rows) => rows.filter((item) => item.id !== attachment.id));
      setRetainedAttachmentIds((ids) => ids.filter((id) => id !== attachment.id));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "移除附件失敗");
    }
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
  };

  // ── 逐收件人不同內容（表格編輯）──────────────────────────────────────────────
  const addRecipientRow = () => {
    setRecipientRows((prev) => [...prev, { email: "", name: "", variables: {} }]);
    requestAnimationFrame(() => {
      recipientTableBottomRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  };
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

  const importPastedTable = () => {
    const lines = pasteTableText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      toast.error("請貼上欄位名稱與至少一列資料");
      return;
    }

    const delimiter = lines[0].includes("\t") ? "\t" : ",";
    const cells = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
    const headers = cells[0];
    const emailIndex = headers.findIndex((header) =>
      ["電子郵件", "email", "e-mail"].includes(header.toLowerCase()),
    );
    const nameIndex = headers.findIndex((header) =>
      ["姓名", "用戶姓名", "name"].includes(header.toLowerCase()),
    );
    if (emailIndex < 0 && nameIndex < 0) {
      toast.error("第一列至少需要包含「電子郵件」或「姓名」欄位");
      return;
    }

    const pastedCustomColumns = headers
      .map((header, index) => ({ index, key: normalizeVariableKey(header) }))
      .filter(({ index, key }) => index !== emailIndex && index !== nameIndex && key);
    const keys = pastedCustomColumns.map(({ key }) => key);
    if (new Set(keys).size !== keys.length) {
      toast.error("欄位名稱不可重複");
      return;
    }

    const existingKeys = new Set(variableDefinitions.map((definition) => definition.key));
    const newDefinitions = pastedCustomColumns
      .filter(({ key }) => !existingKeys.has(key))
      .map(({ key }) => ({
        key,
        label: key,
        required: false,
        default_value: "",
      }));
    setVariableDefinitions((definitions) => [...definitions, ...newDefinitions]);

    const importedRows = cells.slice(1).map((row) => ({
        email: emailIndex >= 0 ? (row[emailIndex] ?? "") : "",
        name: nameIndex >= 0 ? (row[nameIndex] ?? "") : "",
        variables: Object.fromEntries(
          pastedCustomColumns.map(({ index, key }) => [key, row[index] ?? ""]),
        ),
      }));
    setRecipientRows((rows) => {
      const meaningfulRows = rows.filter(
        (row) =>
          row.email.trim() ||
          row.name.trim() ||
          Object.values(row.variables).some((value) => value.trim()),
      );
      return [...meaningfulRows, ...importedRows];
    });
    setPreviewRecipientIndex(0);
    setPasteTableText("");
    setPasteTableOpen(false);
    toast.success(`已追加 ${importedRows.length} 列資料`);
  };

  const importedRecipientCount = new Set(
    recipientRows.map((row) => row.email.trim().toLowerCase()).filter(Boolean),
  ).size;
  const estimatedRecipientCount = (count ?? 0) + importedRecipientCount;
  const invalidRecipientRows = recipientRows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) =>
        row.email.trim() &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim()),
    );

  const validate = (needRecipients: boolean): boolean => {
    if (!subject.trim()) {
      toast.error("請填寫信件主旨");
      return false;
    }
    if (variableDefinitions.some((variable) => !variable.key.trim())) {
      toast.error("請填寫所有表格欄位名稱，或移除空白欄位");
      return false;
    }
    const keys = variableDefinitions.map((variable) => variable.key.trim());
    if (new Set(keys).size !== keys.length) {
      toast.error("表格欄位名稱不可重複");
      return false;
    }
    if (invalidRecipientRows.length > 0) {
      toast.error(`有 ${invalidRecipientRows.length} 列電子郵件格式錯誤`);
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
    setBusy(true);
    try {
      const payload = buildPayload();
      const draftPayload = {
        ...payload,
        subject: payload.subject || "未命名草稿",
      };
      const saved = activeDraftId
        ? await emailApi.updateMessage(activeDraftId, draftPayload)
        : await emailApi.createMessage({ ...draftPayload, action: "draft" });
      if (!activeDraftId) {
        setActiveDraftId(saved.id);
        router.replace(`/email?draft=${saved.id}`);
      }
      setDraftMessages((drafts) => [
        saved,
        ...drafts.filter((draft) => draft.id !== saved.id),
      ]);
      clearDraft();
      toast.success(activeDraftId ? "草稿已更新並同步" : "草稿已永久儲存並同步");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "儲存草稿失敗");
    } finally {
      setBusy(false);
    }
  };

  const runPreflight = async (): Promise<EmailPreflightOut | null> => {
    try {
      const payload = buildPayload();
      const result = await emailApi.preflight({
        recipient_spec: recipients,
        variable_definitions: payload.variable_definitions,
        default_variables: payload.default_variables,
        recipient_variables: payload.recipient_variables,
        attachment_ids: payload.attachment_ids,
      });
      setPreflightResult(result);
      if (!result.valid) {
        toast.error("寄送預檢未通過，請先修正收件資料或附件");
        return null;
      }
      return result;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "寄送預檢失敗");
      return null;
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
      if (!(await runPreflight())) return;
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
      if (activeDraftId) {
        await emailApi.updateMessage(activeDraftId, buildPayload());
        await emailApi.sendMessage(activeDraftId);
      } else {
        await emailApi.createMessage({
          ...buildPayload(),
          action: "send",
          idempotency_key: crypto.randomUUID(),
        });
      }
      clearDraft();
      toast.success("信件已排入寄送佇列");
      router.push("/email/logs");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "寄送失敗");
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async () => {
    if (!validate(true)) return;
    setBusy(true);
    const result = await runPreflight();
    setBusy(false);
    if (!result) return;
    if (result.unique_count > CONFIRM_THRESHOLD) {
      setConfirmOpen(true);
      return;
    }
    void doSend();
  };

  const goToNextStep = async () => {
    if (currentStep === 2 && !validate(true)) return;
    if (currentStep === 3 && !validate(false)) return;
    if (currentStep === 4) {
      setBusy(true);
      const result = await runPreflight();
      setBusy(false);
      if (!result) return;
    }
    setCurrentStep((step) => Math.min(5, step + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
          EMAIL
        </p>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">寄送電子郵件</h1>
          <div className="flex flex-wrap gap-1">
            <Link href="/email/templates" className="btn btn-ghost btn-sm">範本</Link>
            <Link href="/email/lists" className="btn btn-ghost btn-sm">名單</Link>
            <Link href="/email/analytics" className="btn btn-ghost btn-sm">分析</Link>
            <Link href="/email/logs" className="btn btn-ghost btn-sm">寄信紀錄</Link>
          </div>
        </div>
        {activeDraftId && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            正在編輯雲端草稿；儲存後會依帳號同步，可在其他裝置繼續編輯。
          </p>
        )}
      </header>

      <nav className="card overflow-x-auto p-2" aria-label="寄信步驟">
        <ol className="grid min-w-[760px] grid-cols-5 gap-1">
          {COMPOSE_STEPS.map((step) => {
            const active = currentStep === step.number;
            const completed = currentStep > step.number;
            return (
              <li key={step.number}>
                <button
                  type="button"
                  className="w-full rounded-lg px-3 py-2 text-left transition-colors"
                  disabled={step.number > currentStep + 1}
                  style={{
                    background: active ? "var(--primary-dim)" : "transparent",
                    color: active ? "var(--primary)" : "var(--text-secondary)",
                    border: `1px solid ${active ? "var(--primary)" : "transparent"}`,
                    opacity: step.number > currentStep + 1 ? 0.45 : 1,
                  }}
                  onClick={() => setCurrentStep(step.number)}
                >
                  <span className="block text-xs font-semibold">
                    {completed ? "完成" : `步驟 ${step.number}`} · {step.label}
                  </span>
                  <span className="mt-0.5 block text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {step.description}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className={`grid gap-5 ${currentStep >= 3 ? "lg:grid-cols-2" : ""}`}>
        {/* ── 編輯區 ─────────────────────────────────────────── */}
        <div className="min-w-0 space-y-4">
          <section className={`card space-y-3 p-4 ${currentStep === 1 ? "" : "hidden"}`}>
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
            <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--primary)" }}>
              <label className="block text-xs font-semibold" style={{ color: "var(--primary)" }}>
                我的草稿
              </label>
              <select
                className="input"
                value={activeDraftId ?? ""}
                onChange={(event) => {
                  const id = event.target.value;
                  if (id) router.push(`/email?draft=${id}`);
                }}
              >
                <option value="">選擇永久儲存的草稿繼續編輯…</option>
                {draftMessages.map((draft) => (
                  <option key={draft.id} value={draft.id}>
                    {draft.subject || "未命名草稿"} · 更新於{" "}
                    {new Date(draft.updated_at).toLocaleString("zh-TW")}
                  </option>
                ))}
              </select>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                草稿依帳號同步，選擇後會載入原本的內容與收件資料。
              </p>
            </div>
            <div className="space-y-2">
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                平台範本
              </label>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <select
                  className="input min-w-0"
                  value={platformTemplateId}
                  onChange={(e) => applyPlatformTemplate(e.target.value)}
                >
                  <option value="">選擇私人或組織共享範本…</option>
                  {platformTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.is_favorite ? "★ " : ""}
                      {template.name}
                      {template.visibility === "org" ? "（組織）" : ""}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary btn-sm" onClick={savePlatformTemplate}>
                  另存平台範本
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                套用過去郵件格式
              </label>
              <select
                className="input"
                value={recentMessageId}
                onChange={(event) => void applyRecentMessage(event.target.value)}
              >
                <option value="">選擇以前寄發或儲存的郵件…</option>
                {recentMessages.map((message) => (
                  <option key={message.id} value={message.id}>
                    {message.subject} · {new Date(message.created_at).toLocaleDateString("zh-TW")}
                  </option>
                ))}
              </select>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                只套用信件內容、版型與欄位，不會帶入舊收件人。
              </p>
            </div>
            <div className="space-y-2">
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                舊版瀏覽器範本
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
            <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                先點選主旨或主標題中的插入位置，再點選欄位。
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SYSTEM_VARIABLES.map((variable) => (
                  <button
                    key={variable.token}
                    type="button"
                    className="rounded-full px-2.5 py-1 text-xs"
                    style={{
                      background: "var(--primary-dim)",
                      color: "var(--primary)",
                      border: "1px solid var(--border)",
                    }}
                    onClick={() => insertVariable(variable.token)}
                  >
                    + {variable.label}
                  </button>
                ))}
                {definedVariables.map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    className="rounded-full px-2.5 py-1 text-xs"
                    style={{
                      background: "var(--bg-elevated)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border)",
                    }}
                    onClick={() => insertVariable(`{{ ${variable.key} }}`)}
                  >
                    + {variable.label || variable.key}
                  </button>
                ))}
              </div>
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

          <section className={`card space-y-2 p-4 ${currentStep === 3 ? "" : "hidden"}`}>
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

          <section className={`card space-y-2 p-4 ${currentStep === 3 ? "" : "hidden"}`}>
            <div>
              <h2 className="text-sm font-semibold">內文</h2>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                點選下方欄位即可插入目前游標位置。
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SYSTEM_VARIABLES.map((variable) => (
                <button
                  key={variable.token}
                  type="button"
                  className="rounded-full px-2.5 py-1 text-xs"
                  style={{
                    background: "var(--primary-dim)",
                    color: "var(--primary)",
                    border: "1px solid var(--border)",
                  }}
                  onClick={() => insertVariable(variable.token)}
                >
                  + {variable.label}
                </button>
              ))}
              {definedVariables.map((variable) => (
                <button
                  key={variable.key}
                  type="button"
                  className="rounded-full px-2.5 py-1 text-xs"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border)",
                  }}
                  onClick={() => insertVariable(`{{ ${variable.key} }}`)}
                >
                  + {variable.label || variable.key}
                </button>
              ))}
            </div>
            <div onFocus={() => (lastFocusRef.current = "body")}>
              <RichTextarea
                ref={bodyRef}
                value={body}
                onChange={setBody}
                placeholder="撰寫信件內文…"
                lineHeight={bodyLineHeight}
                paragraphSpacing={paragraphSpacing}
              />
            </div>
            <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold">在內文後加入內容</h3>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    適合插入獨立圖片、補充段落或視覺分隔線。
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => addBlock("text")}>
                    + 補充文字
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => addBlock("image")}>
                    + 圖片
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => addBlock("divider")}>
                    + 分隔線
                  </button>
                </div>
              </div>
              {blocks.map((block, index) => (
                <div
                  key={index}
                  className="space-y-2 rounded-lg border p-2"
                  style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                      {block.type === "text" ? "補充文字" : block.type === "image" ? "圖片" : "分隔線"}
                    </span>
                    <div className="flex gap-1">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={index === 0} onClick={() => moveBlock(index, -1)}>↑</button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={index === blocks.length - 1} onClick={() => moveBlock(index, 1)}>↓</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeBlock(index)}>×</button>
                    </div>
                  </div>
                  {block.type === "text" && (
                    <textarea
                      className="input min-h-20"
                      value={block.md ?? ""}
                      placeholder="補充段落，支援 Markdown"
                      onChange={(event) => updateBlock(index, { md: event.target.value })}
                    />
                  )}
                  {block.type === "image" && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          className="input min-w-0 flex-1"
                          value={block.url ?? ""}
                          placeholder="圖片網址，或使用右側上傳"
                          onChange={(event) => updateBlock(index, { url: event.target.value })}
                        />
                        <label className="btn btn-secondary btn-sm cursor-pointer">
                          上傳
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/gif,image/webp"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void uploadBlockImage(index, file);
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                      </div>
                      <input
                        className="input"
                        value={block.alt ?? ""}
                        placeholder="圖片替代文字"
                        onChange={(event) => updateBlock(index, { alt: event.target.value })}
                      />
                    </div>
                  )}
                  {block.type === "divider" && (
                    <div className="border-t" style={{ borderColor: "var(--border-strong)" }} />
                  )}
                </div>
              ))}
            </div>
          </section>

          <details className={`card p-4 ${currentStep === 3 ? "" : "hidden"}`}>
            <summary className="cursor-pointer text-sm font-semibold">
              進階外觀與品牌設定
            </summary>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  收件匣預覽文字
                </label>
                <input
                  className="input"
                  value={previewText}
                  maxLength={200}
                  onChange={(event) => setPreviewText(event.target.value)}
                  placeholder="顯示在主旨旁的摘要文字"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["品牌主色", accentColor, setAccentColor],
                  ["郵件背景", backgroundColor, setBackgroundColor],
                  ["內容背景", contentBackgroundColor, setContentBackgroundColor],
                ].map(([label, value, setter]) => (
                  <label key={String(label)} className="text-xs">
                    <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>{String(label)}</span>
                    <span className="flex items-center gap-2">
                      <input
                        type="color"
                        className="h-10 w-12 cursor-pointer rounded border p-1"
                        style={{ borderColor: "var(--border)" }}
                        value={String(value)}
                        onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                      />
                      <input
                        className="input min-w-0 font-mono text-xs"
                        value={String(value)}
                        maxLength={7}
                        onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                      />
                    </span>
                  </label>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
                    段內行距
                  </span>
                  <input
                    type="number"
                    className="input"
                    min={1.2}
                    max={2.5}
                    step={0.05}
                    value={bodyLineHeight}
                    onChange={(event) => {
                      if (event.target.value) setBodyLineHeight(Number(event.target.value));
                    }}
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>
                    段落間距（px）
                  </span>
                  <input
                    type="number"
                    className="input"
                    min={0}
                    max={40}
                    step={1}
                    value={paragraphSpacing}
                    onChange={(event) => {
                      if (event.target.value) setParagraphSpacing(Number(event.target.value));
                    }}
                  />
                </label>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  自訂頁尾文字
                </label>
                <textarea
                  className="input min-h-20"
                  value={footerText}
                  maxLength={500}
                  onChange={(event) => setFooterText(event.target.value)}
                  placeholder="例如：資訊部 敬上"
                />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={showSystemFooter}
                  onChange={(event) => setShowSystemFooter(event.target.checked)}
                />
                顯示系統名稱、退訂連結與通知偏好頁尾
              </label>
            </div>
          </details>

          <section className={`card space-y-3 p-4 ${currentStep === 2 ? "" : "hidden"}`}>
            <div className="space-y-2 rounded-lg p-3" style={{ background: "var(--bg-elevated)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                    收件人資料表
                  </span>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    直接編輯表頭與資料。每個表頭都會自動成為同名佔位符。
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPasteTableOpen((open) => !open)}
                  >
                    貼上表格
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addVariableDefinition}>
                    + 新增欄位
                  </button>
                </div>
              </div>
              {pasteTableOpen && (
                <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    可只貼姓名與電子郵件，也可包含部分自訂欄位；資料會追加在現有表格後方。
                  </p>
                  <textarea
                    className="input min-h-28 font-mono text-xs"
                    value={pasteTableText}
                    onChange={(event) => setPasteTableText(event.target.value)}
                    placeholder={"電子郵件\t姓名\t錄取部門\t錄取部門數\nted981026@gmail.com\t黃丞廷\t資訊部\t1"}
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPasteTableOpen(false)}>
                      取消
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={importPastedTable}>
                      匯入表格
                    </button>
                  </div>
                </div>
              )}
              <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <table className="w-max min-w-full border-separate border-spacing-1">
                  <thead>
                    <tr className="text-left text-xs" style={{ color: "var(--text-muted)" }}>
                      <th className="min-w-56 px-1">
                        電子郵件
                        <code className="ml-2 font-normal" style={{ color: "var(--primary)" }}>
                          {"{{ 電子郵件 }}"}
                        </code>
                      </th>
                      <th className="min-w-40 px-1">
                        姓名
                        <code className="ml-2 font-normal" style={{ color: "var(--primary)" }}>
                          {"{{ 姓名 }}"}
                        </code>
                      </th>
                      {variableDefinitions.map((variable, i) => (
                        <th key={i} className="min-w-52 px-1">
                          <div className="flex items-center gap-1">
                            <input
                              className="input min-w-36 py-1 text-xs"
                              value={variable.key}
                              maxLength={64}
                              placeholder="欄位名稱"
                              aria-label={`第 ${i + 1} 個自訂欄位名稱`}
                              onChange={(event) => updateVariableName(i, event.target.value)}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label={`移除欄位 ${variable.key || i + 1}`}
                              onClick={() => removeVariable(i)}
                            >
                              ×
                            </button>
                          </div>
                          <code className="mt-1 block font-normal" style={{ color: "var(--primary)" }}>
                            {variable.key ? `{{ ${variable.key} }}` : "輸入名稱後自動產生"}
                          </code>
                        </th>
                      ))}
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {recipientRows.map((row, i) => (
                      <tr key={i}>
                        <td>
                          <input
                            className="input min-w-56"
                            type="email"
                            value={row.email}
                            placeholder="user@example.com"
                            style={{
                              borderColor:
                                row.email.trim() &&
                                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())
                                  ? "var(--danger)"
                                  : undefined,
                            }}
                            onChange={(e) => updateRecipientRow(i, { email: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="input min-w-36"
                            value={row.name}
                            placeholder="王小明"
                            onChange={(e) => updateRecipientRow(i, { name: e.target.value })}
                          />
                        </td>
                        {variableDefinitions.map((variable, variableIndex) => (
                          <td key={`${variableIndex}-${variable.key}`}>
                            <input
                              className="input min-w-40"
                              value={row.variables[variable.key] ?? ""}
                              placeholder={variable.key}
                              onChange={(e) =>
                                updateRecipientVar(i, variable.key, e.target.value)
                              }
                            />
                          </td>
                        ))}
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label="移除此資料列"
                            onClick={() => removeRecipientRow(i)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {recipientRows.length === 0 && (
                <p className="py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                  尚無資料，請新增第一列。
                </p>
              )}
              {invalidRecipientRows.length > 0 && (
                <p className="text-xs" style={{ color: "var(--danger)" }}>
                  有 {invalidRecipientRows.length} 列電子郵件格式錯誤，已以紅框標示。
                </p>
              )}
              <div ref={recipientTableBottomRef} className="flex justify-center border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={addRecipientRow}>
                  + 新增資料列
                </button>
              </div>
            </div>
          </section>

          <section className={`card space-y-3 p-4 ${currentStep === 3 ? "" : "hidden"}`}>
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

          <section className="hidden">
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

          <section className={`card space-y-2 p-4 ${currentStep === 2 ? "" : "hidden"}`}>
            <h2 className="text-sm font-semibold">收件對象</h2>
            <select
              className="input"
              value={recipientListId}
              onChange={(e) => applyRecipientList(e.target.value)}
            >
              <option value="">套用已儲存名單（選填）…</option>
              {recipientLists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}（{list.members.length} 人）
                </option>
              ))}
            </select>
            <RecipientPicker onChange={setRecipients} disabled={busy} />
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {count === null
                ? importedRecipientCount > 0
                  ? `已從表格匯入 ${importedRecipientCount} 人`
                  : "尚未選擇收件人"
                : `預計寄送約 ${estimatedRecipientCount} 人`}
              {sampleNames.length > 0 && `（${sampleNames.join("、")}${count && count > sampleNames.length ? " …" : ""}）`}
            </p>
          </section>

          <section className={`card space-y-3 p-4 ${currentStep === 3 ? "" : "hidden"}`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">附件</h2>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  小檔直接附加；較大檔案自動改為限時安全下載連結。
                </p>
              </div>
              <label className={`btn btn-secondary btn-sm ${uploadingAttachment ? "cursor-wait opacity-70" : "cursor-pointer"}`}>
                {uploadingAttachment ? "上傳中…" : "+ 上傳附件"}
                <input
                  type="file"
                  className="hidden"
                  disabled={uploadingAttachment}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadAttachment(file);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            {attachments.map((attachment) => (
              <div key={attachment.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border)" }}>
                <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {(attachment.file_size / 1024 / 1024).toFixed(2)} MB ·
                  {attachment.delivery_mode === "attachment" ? " 實體附件" : " 安全連結"}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeAttachment(attachment)}>移除</button>
              </div>
            ))}
          </section>
        </div>

        {/* ── 預覽與動作 ─────────────────────────────────────── */}
        <div className={`min-w-0 space-y-4 ${currentStep >= 3 ? "" : "hidden"}`}>
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
                  onChange={(e) => setPreviewRecipientIndex(Number(e.target.value))}
                  aria-label="選擇預覽收件人"
                >
                  {recipientRows.map((row, index) => (
                    <option key={`${row.email}-${index}`} value={index}>
                      {row.name || row.email || `第 ${index + 1} 列`}
                      {row.name && row.email ? `（${row.email}）` : ""}
                    </option>
                  ))}
                </select>
              )}
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
                {previewError || "填寫主旨後即可預覽"}
              </div>
            )}
          </section>

          <section className={`card space-y-3 p-4 ${currentStep >= 4 ? "" : "hidden"}`}>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={trackOpens} onChange={(e) => setTrackOpens(e.target.checked)} />
                追蹤開信率（估計值）
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={trackClicks} onChange={(e) => setTrackClicks(e.target.checked)} />
                追蹤連結點擊
              </label>
            </div>
            {preflightResult && (
              <div className="rounded-lg border p-3 text-xs" style={{ borderColor: preflightResult.valid ? "var(--success)" : "var(--danger)" }}>
                <p className="font-semibold">
                  預檢{preflightResult.valid ? "通過" : "未通過"} · 去重後 {preflightResult.unique_count} 人 · 預計 {preflightResult.estimated_batches} 批
                </p>
                {preflightResult.duplicate_emails.length > 0 && <p>重複地址：{preflightResult.duplicate_emails.length}</p>}
                {preflightResult.suppressed_emails.length > 0 && <p>已排除退訂／退信：{preflightResult.suppressed_emails.length}</p>}
                {preflightResult.missing_variables.length > 0 && <p style={{ color: "var(--danger)" }}>缺少必要欄位：{preflightResult.missing_variables.length}</p>}
              </div>
            )}
            {currentStep === 5 && <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                預約寄送時間（選填）
              </label>
              <input
                type="datetime-local"
                className="input"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>}
            <div className="flex flex-wrap gap-2">
              {currentStep === 4 && <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={handleTest}
              >
                測試寄給我
              </button>}
              {currentStep === 4 && <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={async () => {
                  try {
                    const result = await emailApi.testSample({
                      ...buildPayload(),
                      recipient_indexes: recipientRows.slice(0, 3).map((_, index) => index),
                      test_emails: [],
                    });
                    toast.success(`已排入 ${result.queued} 封抽樣測試信`);
                  } catch (e) {
                    toast.error(e instanceof ApiError ? e.message : "抽樣測試失敗");
                  }
                }}
              >
                抽樣測試
              </button>}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={handleSaveDraft}
              >
                永久儲存草稿
              </button>
              {currentStep === 5 && <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || !scheduledAt}
                onClick={handleSchedule}
              >
                預約寄送
              </button>}
              {currentStep === 5 && <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={handleSend}
              >
                立即寄送
              </button>}
            </div>
            {lastSavedAt && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                ✓ 內容已自動暫存於本機，重新整理或關閉分頁也不會遺失
              </p>
            )}
          </section>
        </div>
      </div>

      <div className="sticky bottom-3 z-20 flex items-center justify-between rounded-xl border p-3 shadow-lg backdrop-blur" style={{ background: "color-mix(in srgb, var(--bg-surface) 92%, transparent)", borderColor: "var(--border)" }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={currentStep === 1 || busy}
          onClick={() => setCurrentStep((step) => Math.max(1, step - 1))}
        >
          上一步
        </button>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {COMPOSE_STEPS[currentStep - 1].label}
        </span>
        {currentStep < 5 ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void goToNextStep()}>
            {currentStep === 4 ? "完成檢查" : "下一步"}
          </button>
        ) : (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            請在上方確認寄送方式
          </span>
        )}
      </div>

      {confirmOpen && (
        <Modal title="確認大量寄送" onClose={() => setConfirmOpen(false)} size="md">
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            這封信將寄送給 <strong>{preflightResult?.unique_count ?? estimatedRecipientCount}</strong> 位收件人，
            共 {preflightResult?.estimated_batches ?? 1} 批，確定要立即送出嗎？
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            開信追蹤：{trackOpens ? "開啟" : "關閉"} · 點擊追蹤：{trackClicks ? "開啟" : "關閉"} · 附件 {attachments.length} 個
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
