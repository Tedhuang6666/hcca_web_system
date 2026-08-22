/**
 * 公開站導覽列的「單一來源」。
 *
 * PublicSiteShell（前台渲染）與 admin/public-site（後台客製化）都從這裡讀取內建項目，
 * 不再各自重寫一份硬編碼清單。後台的開關／排序／改名只存「覆寫」到
 * settings.theme_config.nav，免 DB migration；前台用 resolvePublicNav() 把預設與覆寫合併。
 */
import type { ModuleId } from "./modules";

/** 每個項目只屬於一組；公開站以高頻任務作頂列，完整清單收進「所有公開服務」。 */
export type PublicNavGroupId = "primary" | "info" | "data" | "participation";

export interface PublicNavItemDef {
  /** 穩定 id，後台覆寫以此為 key，勿隨意更動。 */
  key: string;
  href: string;
  /** 預設文案，後台可覆寫。 */
  label: string;
  description: string;
  iconKey: string;
  group: PublicNavGroupId;
  /** 對應的功能模組；模組關閉時不在公開站顯示。 */
  moduleId?: ModuleId;
  /** 未登入者也能直接使用（顯示「免登入」標記）。 */
  guestUsable?: boolean;
}

export const PUBLIC_NAV_GROUP_META: Record<
  PublicNavGroupId,
  { label: string; hint?: string }
> = {
  primary: { label: "主要導覽" },
  info: { label: "資訊與組織" },
  data: { label: "公開資料查詢" },
  participation: { label: "公共參與" },
};

/** 顯示順序＝陣列順序（同組內）。後台 order 覆寫只調整同組相對位置。 */
export const PUBLIC_NAV_ITEMS: PublicNavItemDef[] = [
  { key: "news", href: "/news", label: "最新公告", description: "公開消息與重要通知", iconKey: "news", group: "primary", moduleId: "announcements" },
  { key: "about", href: "/about", label: "關於班聯會", description: "任務、沿革與公共角色", iconKey: "about", group: "primary" },
  { key: "system-info", href: "/system-info", label: "關於本系統", description: "協助、回報與公開說明", iconKey: "system-info", group: "primary" },

  { key: "officers", href: "/officers", label: "班聯會幹部", description: "當屆幹部與公開資料", iconKey: "officers", group: "info", guestUsable: true },
  { key: "contact", href: "/contact", label: "聯絡我們", description: "聯絡班聯會與提出問題", iconKey: "contact", group: "info", guestUsable: true },
  { key: "links", href: "/links", label: "平台連結", description: "常用服務與外部連結", iconKey: "links", group: "info", guestUsable: true },

  { key: "public-db", href: "/public", label: "公開資料庫", description: "所有公開資料與參與入口", iconKey: "public-db", group: "data", guestUsable: true },
  { key: "regulations", href: "/regulations", label: "法規查詢", description: "現行條文、沿革與版本", iconKey: "regulations", group: "data", guestUsable: true, moduleId: "regulations" },
  { key: "documents", href: "/documents", label: "公文查詢", description: "公開公文、字號與附件", iconKey: "documents", group: "data", guestUsable: true, moduleId: "documents" },
  { key: "elections", href: "/public/elections", label: "即時開票", description: "公開選舉票數與進度", iconKey: "elections", group: "data", guestUsable: true, moduleId: "elections" },
  { key: "special-agreement", href: "/public/special-agreement", label: "特約洽談", description: "合作流程、洽談資訊與文件", iconKey: "special-agreement", group: "data", guestUsable: true },
  { key: "partner-map", href: "/partner-map", label: "特約地圖", description: "合作店家與學生優惠", iconKey: "partner-map", group: "data", guestUsable: true, moduleId: "partnerMap" },
  { key: "surveys", href: "/surveys", label: "公開問卷", description: "參與目前開放的校園調查", iconKey: "surveys", group: "data", guestUsable: true, moduleId: "surveys" },

  { key: "petitions", href: "/petitions/public", label: "公開陳情", description: "閱讀公開案件與回覆，也可以提出新的陳情", iconKey: "petitions", group: "participation", guestUsable: true, moduleId: "petitions" },
];

/** 後台存進 settings.theme_config.nav 的覆寫形狀。 */
export interface PublicNavOverride {
  hidden?: boolean;
  label?: string;
  order?: number;
}

export interface PublicNavConfig {
  items?: Record<string, PublicNavOverride>;
}

export interface ResolvedNavItem extends PublicNavItemDef {
  hidden: boolean;
  order: number;
}

/** 從 theme_config 取出 nav 覆寫設定（容錯：型別不符一律當空）。 */
export function readNavConfig(
  themeConfig: Record<string, unknown> | null | undefined,
): PublicNavConfig {
  const nav = themeConfig?.nav;
  if (!nav || typeof nav !== "object") return {};
  const items = (nav as PublicNavConfig).items;
  if (!items || typeof items !== "object") return {};
  return { items };
}

/** 合併內建預設與後台覆寫，回傳所有項目（含隱藏者，供後台列表用）。 */
export function resolvePublicNav(
  themeConfig: Record<string, unknown> | null | undefined,
): ResolvedNavItem[] {
  const overrides = readNavConfig(themeConfig).items ?? {};
  return PUBLIC_NAV_ITEMS.map((item, index) => {
    const o = overrides[item.key] ?? {};
    return {
      ...item,
      label: o.label?.trim() || item.label,
      hidden: o.hidden === true,
      order: typeof o.order === "number" && Number.isFinite(o.order) ? o.order : index,
    };
  });
}

/** 過濾隱藏、依 order 排序後，拆成各組（前台渲染用）。 */
export function groupResolvedNav(items: ResolvedNavItem[]) {
  const sorted = items
    .filter((item) => !item.hidden)
    .sort((a, b) => a.order - b.order);
  const byGroup = (group: PublicNavGroupId) => sorted.filter((item) => item.group === group);
  return {
    primary: byGroup("primary"),
    info: byGroup("info"),
    data: byGroup("data"),
    participation: byGroup("participation"),
  };
}
