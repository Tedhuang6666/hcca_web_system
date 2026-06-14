/**
 * 公開站導覽列的「單一來源」。
 *
 * PublicSiteShell（前台渲染）與 admin/public-site（後台客製化）都從這裡讀取內建項目，
 * 不再各自重寫一份硬編碼清單。後台的開關／排序／改名只存「覆寫」到
 * settings.theme_config.nav，免 DB migration；前台用 resolvePublicNav() 把預設與覆寫合併。
 */
import type { LucideIcon } from "lucide-react";
import {
  BookOpenText,
  FileSearch,
  Landmark,
  Link2,
  ListChecks,
  MapPinned,
  Megaphone,
  MessageSquareText,
  Radio,
  Scale,
  UsersRound,
} from "lucide-react";

/** primary 顯示在頂列；其餘三組收進「所有公開服務」選單。每個項目只屬於一組，從結構上杜絕重複。 */
export type PublicNavGroupId = "primary" | "info" | "data" | "participation";

export interface PublicNavItemDef {
  /** 穩定 id，後台覆寫以此為 key，勿隨意更動。 */
  key: string;
  href: string;
  /** 預設文案，後台可覆寫。 */
  label: string;
  description: string;
  icon: LucideIcon;
  group: PublicNavGroupId;
  /** 互動型模組，未登入者也能直接使用（顯示「免登入」標記）。 */
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
  { key: "news", href: "/news", label: "最新公告", description: "公開消息與重要通知", icon: Megaphone, group: "primary" },
  { key: "about", href: "/about", label: "關於班聯會", description: "任務、沿革與公共角色", icon: Landmark, group: "primary" },

  { key: "officers", href: "/officers", label: "班聯會幹部", description: "當屆幹部與公開資料", icon: UsersRound, group: "info" },
  { key: "links", href: "/links", label: "平台連結", description: "常用服務與外部連結", icon: Link2, group: "info" },

  { key: "public-db", href: "/public", label: "公開資料庫", description: "所有公開資料與參與入口", icon: BookOpenText, group: "data" },
  { key: "regulations", href: "/public/regulations", label: "法規查詢", description: "現行條文、沿革與版本", icon: Scale, group: "data" },
  { key: "documents", href: "/public/documents", label: "公文查詢", description: "公開公文、字號與附件", icon: FileSearch, group: "data" },
  { key: "elections", href: "/public/elections", label: "即時開票", description: "公開選舉票數與進度", icon: Radio, group: "data" },
  { key: "partner-map", href: "/partner-map", label: "特約地圖", description: "合作店家與學生優惠", icon: MapPinned, group: "data" },
  { key: "surveys", href: "/surveys", label: "公開問卷", description: "參與目前開放的校園調查", icon: ListChecks, group: "data", guestUsable: true },

  { key: "council-proposals", href: "/council-proposals", label: "議會提案", description: "向學生代表大會提案", icon: Landmark, group: "participation" },
  { key: "petition-new", href: "/petitions/new", label: "提出陳情", description: "反映校園問題與建議", icon: MessageSquareText, group: "participation", guestUsable: true },
  { key: "petitions", href: "/petitions", label: "陳情中心", description: "用案號查詢陳情進度", icon: MessageSquareText, group: "participation", guestUsable: true },
  { key: "judicial-petitions", href: "/judicial-petitions", label: "評議聲請", description: "提出審查與爭議事項", icon: Scale, group: "participation" },
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
