import type {
  EmailBlock,
  EmailButton,
  EmailButtonStyle,
  EmailCardRow,
  EmailVariableDefinition,
  RecipientSelector,
} from "@/lib/types";

export const EMPTY_RECIPIENTS: RecipientSelector = {
  user_ids: [],
  position_ids: [],
  org_ids: [],
  external_emails: [],
  include_all: false,
  include_school: false,
};

/** 情境預設：選取後預填主標題、重點卡片與行動按鈕文字 */
export const PRESETS: {
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

export const CONFIRM_THRESHOLD = 100;
export const AUTOSAVE_KEY = "email-compose";
export const TEMPLATE_KEY = "email-templates";

export const BUTTON_STYLE_OPTIONS: { value: EmailButtonStyle; label: string }[] = [
  { value: "primary", label: "主要（深色）" },
  { value: "secondary", label: "次要（金色）" },
  { value: "outline", label: "外框" },
];

export const COMPOSE_STEPS = [
  { number: 1, label: "選擇起點", description: "空白、範本或過去郵件" },
  { number: 2, label: "收件資料", description: "建立名單與個人化欄位" },
  { number: 3, label: "郵件內容", description: "編輯並即時預覽" },
  { number: 4, label: "寄送檢查", description: "預檢與抽樣測試" },
  { number: 5, label: "確認寄送", description: "立即或預約寄送" },
] as const;

/** 系統內建可用變數（一律可插入） */
export const SYSTEM_VARIABLES: { token: string; label: string }[] = [
  { token: "{{ 姓名 }}", label: "姓名" },
  { token: "{{ 電子郵件 }}", label: "電子郵件" },
  { token: "{{ unsubscribe_url }}", label: "退訂連結" },
];

export const normalizeVariableKey = (rawName: string) =>
  rawName
    .trimStart()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .replace(/^\p{N}+/u, "")
    .slice(0, 64);

/** 逐收件人指定不同內容的一列（表格編輯，取代手寫 JSON） */
export type RecipientRow = { email: string; name: string; variables: Record<string, string> };

/** 自動暫存的草稿內容（不含收件人） */
export type ComposeDraft = {
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

export type TemplateContent = Omit<ComposeDraft, "recipientRows">;

export type SavedTemplate = TemplateContent & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};
