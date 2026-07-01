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
  meetings: "議事系統",
  regulations: "法規查詢",
  announcements: "校內公告",
  shop: "商品訂購",
  meal: "學餐訂購",
  "partner-map": "特約地圖",
  surveys: "問卷專區",
  petitions: "陳情中心",
  notifications: "通知中心",
  tasks: "我的待辦",
  orgs: "組織",
  profile: "個人資料",
  admin: "管理",
  analytics: "績效統計",
  "audit-logs": "稽核日誌",
  "serial-templates": "字號模板",
  email: "電子郵件",
  settings: "設定",
  about: "關於本系統",
};

const PATH_OVERRIDES: Record<string, string> = {
  "/":                            "平台首頁",
  "/admin":                       "管理後台",
  "/documents/new":               "新增公文",
  "/documents/delegations":       "簽核代理",
  "/regulations/new":             "新增法規",
  "/regulations/pending":         "待議法規",
  "/meetings/calendar":           "會議行事曆",
  "/announcements/new":           "新增公告",
  "/shop/admin":                  "商品後台",
  "/shop/orders":                 "我的訂單",
  "/shop/class-orders":           "班級訂單",
  "/meal/vendor":                 "商家管理",
  "/meal/orders":                 "我的餐單",
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
  "/settings/notifications":      "通知偏好",
  "/settings/security":           "安全設定",
  "/about":                       "關於本系統",
};

/**
 * 這些累積路徑沒有對應的 page.tsx（只是 URL 分段），
 * 麵包屑中應顯示為「文字標籤」而非可點擊連結，避免 404。
 */
const LABEL_ONLY_PATHS: Set<string> = new Set([
  "/settings",
  "/meetings/join",
  "/meetings/screen",
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
  { re: /^\/meetings\/[^/]+\/edit$/,              label: "編輯會議" },
  { re: /^\/meetings\/[^/]+\/control$/,           label: "議事控制台" },
  { re: /^\/meetings\/[^/]+\/vote$/,              label: "表決" },
  { re: /^\/meetings\/[^/]+$/,                    label: "會議詳情" },
  { re: /^\/meetings\/join\/[^/]+$/,              label: "加入會議" },
  { re: /^\/meetings\/screen\/[^/]+$/,            label: "會議螢幕" },
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

function labelFor(pathname: string, segment: string, parentSegment?: string): string {
  if (PATH_OVERRIDES[pathname]) return PATH_OVERRIDES[pathname];
  for (const { re, label } of DYNAMIC_PATTERNS) {
    if (re.test(pathname)) return label;
  }
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  if (looksLikeId(segment)) {
    const parentLabel = parentSegment ? SEGMENT_LABELS[parentSegment] : undefined;
    return parentLabel ? `${parentLabel}詳情` : "詳情";
  }
  // 未知 segment：原樣顯示（首字大寫）
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/**
 * 從 pathname 推導麵包屑序列。
 * 第一筆固定為「首頁」，最後一筆不附 href（current page）。
 */
export function getBreadcrumbs(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "首頁", href: "/" }];
  if (pathname === "/" || pathname === "") return crumbs;

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
export function getPageTitle(pathname: string): string {
  const crumbs = getBreadcrumbs(pathname);
  const last = crumbs[crumbs.length - 1];
  return last?.label ?? "校園自治整合平台";
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
