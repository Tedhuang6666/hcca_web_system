/**
 * 麵包屑與頁面標題：以 pathname 為單一來源。
 *
 * - SEGMENT_LABELS：URL segment → 中文標籤
 * - PATH_OVERRIDES：完整 pathname 的覆寫（用於子頁面標題）
 * - DYNAMIC_PATTERNS：動態 id 段的 fallback（如 /documents/HCCA-123 → 「公文詳情」）
 */

export interface Crumb {
  label: string;
  href?: string;
}

const SEGMENT_LABELS: Record<string, string> = {
  documents: "公文系統",
  "document-templates": "公文範本",
  regulations: "法規查詢",
  announcements: "校內公告",
  shop: "商品訂購",
  "partner-map": "特約地圖",
  surveys: "問卷專區",
  petitions: "陳情中心",
  notifications: "通知中心",
  tasks: "我的待辦",
  orgs: "組織",
  operations: "營運中心",
  profile: "個人資料",
  admin: "管理",
  analytics: "績效統計",
  "audit-logs": "稽核日誌",
  "serial-templates": "字號模板",
  email: "電子郵件",
  settings: "設定",
  about: "關於本系統",
  dashboard: "平台首頁",
  "work-items": "我的工作",
  "council-proposals": "議會提案",
  "judicial-petitions": "評議訴訟",
  credential: "電子證件",
  "exam-papers": "段考題庫",
  finance: "預算與收支",
  publications: "發布中心",
  backoffice: "模組後台",
  "recommended-vendors": "推薦商家",
  "merchandise-submissions": "校商投稿",
  "qr-code": "經營工具",
  search: "搜尋",
  delegations: "簽核代理",
  archived: "已廢止法規",
  pending: "待議法規",
  new: "新增",
  edit: "編輯",
  cart: "購物車",
  orders: "我的訂單",
  lists: "收件名單",
  logs: "寄送紀錄",
  templates: "郵件範本",
  manage: "管理",
  "my-businesses": "我的店家",
  types: "類型",
  account: "帳號與個人資料",
  "data-saver": "省流模式",
  integrations: "外部整合",
  navigation: "介面導覽設定",
  privacy: "隱私與資料",
  security: "安全設定",
  "api-keys": "API 金鑰",
  classes: "班級管理",
  "data-lifecycle": "資料保存",
  diagnostics: "系統診斷",
  discord: "Discord 機器人",
  elections: "開票控制台",
  "feature-flags": "功能開關",
  gallery: "活動影像",
  modules: "模組狀態",
  "navigation-profiles": "視角管理",
  people: "人員與組織",
  permissions: "權限管理",
  policies: "政策文件",
  "public-site": "公開網站設定",
  raffle: "現場抽獎",
  reports: "報表",
  system: "系統營運",
  "term-rollover": "學期換屆",
  trash: "回收桶",
  "user-lifecycle": "帳號生命週期",
  users: "使用者",
  webhooks: "Webhook",
};

const PATH_OVERRIDES: Record<string, string> = {
  "/":                            "平台首頁",
  "/admin":                       "系統總覽",
  "/admin/system":                "系統營運",
  "/admin/settings":              "系統設定",
  "/shop/admin/stats":            "訂購統計",
  "/exam-papers/admin":           "題庫管理",
  "/merchandise-submissions/admin": "校商投稿管理",
  "/recommended-vendors/admin":   "推薦商家管理",
  "/email/analytics":             "寄送成效",
  "/publications/new":            "新增發布",
  "/documents/new":               "新增公文",
  "/documents/delegations":       "簽核代理",
  "/regulations/new":             "新增法規",
  "/regulations/pending":         "待議法規",
  "/announcements/new":           "新增公告",
  "/shop/admin":                  "商品設定",
  "/shop/orders":                 "我的預購與代訂",
  "/shop/class-orders":           "班級收款與代訂",
  "/shop/council-orders":         "班聯工作",
  "/partner-map/admin":           "特約管理",
  "/surveys/new":                 "新增問卷",
  "/petitions/new":               "我要陳情",
  "/petitions/manage":            "陳情管理",
  "/petitions/admin/types":       "陳情類型",
  "/admin/permissions":           "權限管理",
  "/admin/people":                "人員身分",
  "/admin/classes":               "班級管理",
  "/admin/navigation-profiles":   "視角管理",
  "/settings/navigation":         "介面導覽設定",
  "/settings/account":            "帳號與個人資料",
  "/settings/notifications":      "通知偏好",
  "/settings/security":           "安全設定",
  "/about":                       "關於本系統",
  "/system-info":                 "關於本系統",
};

/**
 * 這些累積路徑沒有對應的 page.tsx（只是 URL 分段），
 * 麵包屑中應顯示為「文字標籤」而非可點擊連結，避免 404。
 */
const LABEL_ONLY_PATHS: Set<string> = new Set([
  "/settings",
  "/petitions/admin",
  "/auth",
]);

/** 動態 id 段對應的 fallback 標題；最先匹配者勝出。 */
const DYNAMIC_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /^\/documents\/[^/]+\/edit$/,             label: "編輯公文" },
  { re: /^\/documents\/[^/]+$/,                   label: "公文詳情" },
  { re: /^\/regulations\/[^/]+\/edit(\/.*)?$/,    label: "編輯法規" },
  { re: /^\/regulations\/[^/]+\/amendment(\/.*)?$/, label: "法規修正案" },
  { re: /^\/regulations\/[^/]+$/,                 label: "法規詳情" },
  { re: /^\/announcements\/[^/]+\/edit$/,         label: "編輯公告" },
  { re: /^\/announcements\/[^/]+$/,               label: "公告詳情" },
  { re: /^\/surveys\/[^/]+\/edit$/,               label: "編輯問卷" },
  { re: /^\/surveys\/[^/]+$/,                     label: "問卷詳情" },
  { re: /^\/orgs\/[^/]+$/,                        label: "組織詳情" },
  { re: /^\/petitions\/[^/]+$/,                   label: "陳情詳情" },
];

/** segment 是否屬於 ID 風格（UUID、有 dash、純數字、長度 >= 4） */
function looksLikeId(segment: string): boolean {
  if (/^[0-9a-fA-F-]{8,}$/.test(segment)) return true;
  if (/^\d+$/.test(segment)) return true;
  if (segment.includes("-") && segment.length >= 6) return true;
  return false;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function labelFor(pathname: string, segment: string, parentSegment?: string): string {
  const decodedSegment = decodeSegment(segment);
  const decodedParentSegment = parentSegment ? decodeSegment(parentSegment) : undefined;
  if (PATH_OVERRIDES[pathname]) return PATH_OVERRIDES[pathname];
  for (const { re, label } of DYNAMIC_PATTERNS) {
    if (re.test(pathname)) return label;
  }
  if (SEGMENT_LABELS[decodedSegment]) return SEGMENT_LABELS[decodedSegment];
  if (looksLikeId(decodedSegment)) {
    const parentLabel = decodedParentSegment ? SEGMENT_LABELS[decodedParentSegment] : undefined;
    return parentLabel ? `${parentLabel}詳情` : "詳情";
  }
  // 未知 segment：原樣顯示（首字大寫）
  return decodedSegment.charAt(0).toUpperCase() + decodedSegment.slice(1);
}

/** 登入後介面的起點；訪客瀏覽公開頁時改用公開網站首頁。 */
export const APP_HOME_CRUMB: Crumb = { label: "平台首頁", href: "/dashboard" };
export const PUBLIC_HOME_CRUMB: Crumb = { label: "首頁", href: "/" };

/**
 * 從 pathname 推導麵包屑序列。
 * 第一筆為起點（預設平台首頁），最後一筆不附 href（current page）。
 */
export function getBreadcrumbs(pathname: string, root: Crumb = APP_HOME_CRUMB): Crumb[] {
  if (pathname === "/" || pathname === "" || pathname === root.href) return [{ label: root.label }];
  const crumbs: Crumb[] = [root];

  const segments = pathname.split("/").filter(Boolean);
  let accumulated = "";
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    accumulated += "/" + seg;
    const isLast = i === segments.length - 1;
    const parent = i > 0 ? segments[i - 1] : undefined;
    const label = labelFor(accumulated, seg, parent);
    const isLabelOnly = LABEL_ONLY_PATHS.has(accumulated);
    crumbs.push({
      label,
      href: isLast || isLabelOnly ? undefined : accumulated,
    });
  }
  return crumbs;
}

/**
 * 取頁面標題（麵包屑最後一段，或 fallback）。
 */
export function getPageTitle(pathname: string, root: Crumb = APP_HOME_CRUMB): string {
  const crumbs = getBreadcrumbs(pathname, root);
  const last = crumbs[crumbs.length - 1];
  return last?.label ?? "新竹高中班聯會數位整合系統";
}

/**
 * 行動裝置縮減：保留首頁 + 最後 2 層，中間以省略號表示。
 */
export function getCompactCrumbs(crumbs: Crumb[]): Crumb[] {
  if (crumbs.length <= 3) return crumbs;
  return [
    crumbs[0],
    { label: "…" },
    ...crumbs.slice(-2),
  ];
}
