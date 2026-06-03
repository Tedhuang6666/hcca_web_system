export type NavItem = {
  id: string;
  href: string;
  iconKey: string;
  label: string;
  end?: boolean;
  perm?: string;
};

export type NavSection = {
  id: string;
  heading: string;
  items: NavItem[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
};

export type NavEntry = NavItem | NavSection;

export type NavPreferences = {
  desktopOrder: string[];
  desktopHidden: string[];
  mobileOrder: string[];
  mobileHidden: string[];
};

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", href: "/dashboard", iconKey: "dashboard", label: "平台首頁", end: true },
  { id: "tasks", href: "/tasks", iconKey: "tasks", label: "我的待辦" },
  { id: "announcements", href: "/announcements", iconKey: "announcement", label: "校內公告" },
  { id: "documents", href: "/documents", iconKey: "documents", label: "公文系統" },
  { id: "calendar", href: "/calendar", iconKey: "calendar", label: "行事曆" },
  { id: "meetings", href: "/meetings", iconKey: "meetings", label: "議事系統" },
  { id: "councilProposals", href: "/council-proposals", iconKey: "meetings", label: "議會提案" },
  { id: "regulations", href: "/regulations", iconKey: "regulations", label: "法規查詢" },
  { id: "meal", href: "/meal", iconKey: "meal", label: "學餐訂購" },
  { id: "shop", href: "/shop", iconKey: "shop", label: "校商訂購" },
  {
    id: "shopOrders",
    href: "/shop/class-orders",
    iconKey: "shopOrders",
    label: "班級訂單",
    perm: "class:shop_collect",
  },
  { id: "partnerMap", href: "/partner-map", iconKey: "partnerMap", label: "特約地圖" },
  { id: "surveys", href: "/surveys", iconKey: "survey", label: "問卷專區" },
  { id: "petitions", href: "/petitions", iconKey: "petition", label: "陳情中心" },
  { id: "judicialPetitions", href: "/judicial-petitions", iconKey: "shield", label: "評議訴訟" },
  { id: "examPapers", href: "/exam-papers", iconKey: "examPapers", label: "段考題庫" },
  { id: "about", href: "/about", iconKey: "info", label: "關於本系統" },
  { id: "analytics", href: "/analytics", iconKey: "analytics", label: "績效統計", perm: "analytics:view" },
  { id: "orgs", href: "/orgs", iconKey: "org", label: "組織管理", perm: "org:*" },
  {
    id: "activitiesAdmin",
    href: "/admin/activities",
    iconKey: "calendar",
    label: "活動管理",
    perm: "activity:manage",
  },
  {
    id: "permissions",
    href: "/admin/permissions",
    iconKey: "permissions",
    label: "權限管理",
    perm: "admin:all",
  },
  {
    id: "peopleAdmin",
    href: "/admin/people",
    iconKey: "people",
    label: "人員身分",
    perm: "admin:users",
  },
  {
    id: "systemDefense",
    href: "/admin/system",
    iconKey: "systemDefense",
    label: "系統防護",
    perm: "admin:all",
  },
  {
    id: "systemSettings",
    href: "/admin/settings",
    iconKey: "settings",
    label: "系統設定",
    perm: "admin:all",
  },
  {
    id: "discordAdmin",
    href: "/admin/discord",
    iconKey: "settings",
    label: "Discord 機器人",
    perm: "admin:all",
  },
  {
    id: "publicSiteAdmin",
    href: "/admin/public-site",
    iconKey: "info",
    label: "公開網站設定",
    perm: "site:manage",
  },
  {
    id: "classes",
    href: "/admin/classes",
    iconKey: "classes",
    label: "班級管理",
    perm: "class:manage",
  },
  { id: "audit", href: "/audit-logs", iconKey: "audit", label: "稽核日誌", perm: "audit:view_org" },
  {
    id: "documentTemplates",
    href: "/document-templates",
    iconKey: "documentTemplates",
    label: "公文範本",
    perm: "document:draft",
  },
  {
    id: "serialTemplates",
    href: "/serial-templates",
    iconKey: "serial",
    label: "字號模板",
    perm: "serial:create",
  },
  { id: "email", href: "/email", iconKey: "email", label: "電子郵件", perm: "email:*" },
  { id: "examPaperAdmin", href: "/exam-papers/admin", iconKey: "examPaperAdmin", label: "題庫管理", perm: "exam:manage" },
  { id: "shopAdmin", href: "/shop/admin", iconKey: "shopAdmin", label: "校商後台", perm: "shop:manage" },
  { id: "mealVendor", href: "/meal/vendor", iconKey: "mealVendor", label: "餐商管理", perm: "meal:manage" },
  {
    id: "partnerMapAdmin",
    href: "/partner-map/admin",
    iconKey: "partnerMap",
    label: "特約管理",
    perm: "partner_map:manage",
  },
  {
    id: "petitionsManage",
    href: "/petitions/manage",
    iconKey: "petition",
    label: "陳情管理",
    perm: "petition:*",
  },
  {
    id: "settingsNavigation",
    href: "/settings/navigation",
    iconKey: "settings",
    label: "介面設定",
  },
  {
    id: "settingsNotifications",
    href: "/settings/notifications",
    iconKey: "bell",
    label: "通知設定",
  },
  {
    id: "settingsDataSaver",
    href: "/settings/data-saver",
    iconKey: "wifiOff",
    label: "省流模式",
  },
  {
    id: "settingsPrivacy",
    href: "/settings/privacy",
    iconKey: "shield",
    label: "隱私與資料",
  },
  {
    id: "settingsSecurity",
    href: "/settings/security",
    iconKey: "shield",
    label: "安全設定",
  },
];

export const NAV_ITEMS_BY_ID: Record<string, NavItem> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.id, item]),
);

export const NAV_DEF: NavEntry[] = [
  NAV_ITEMS[0],
  NAV_ITEMS[1],
  {
    id: "news",
    heading: "最新資訊",
    items: byIds(["announcements"]),
  },
  {
    id: "governance",
    heading: "自治核心",
    items: byIds(["documents", "calendar", "meetings", "councilProposals", "regulations", "judicialPetitions"]),
  },
  {
    id: "campusServices",
    heading: "校園服務",
    items: byIds(["meal", "shop", "partnerMap", "surveys", "petitions", "examPapers"]),
  },
  {
    id: "classWork",
    heading: "班級工作",
    items: byIds(["shopOrders", "classes"]),
  },
  {
    id: "operations",
    heading: "營運管理",
    collapsible: true,
    defaultCollapsed: true,
    items: byIds(["analytics", "orgs", "activitiesAdmin", "peopleAdmin", "email"]),
  },
  {
    id: "serviceBackoffice",
    heading: "服務後台",
    collapsible: true,
    defaultCollapsed: true,
    items: byIds([
      "documentTemplates",
      "serialTemplates",
      "examPaperAdmin",
      "shopAdmin",
      "mealVendor",
      "partnerMapAdmin",
      "petitionsManage",
    ]),
  },
  {
    id: "systemAdmin",
    heading: "系統管理",
    collapsible: true,
    defaultCollapsed: true,
    items: byIds([
      "permissions",
      "systemDefense",
      "systemSettings",
      "publicSiteAdmin",
      "discordAdmin",
      "audit",
    ]),
  },
  {
    id: "settings",
    heading: "設定",
    collapsible: true,
    defaultCollapsed: true,
    items: byIds([
      "settingsNavigation",
      "settingsNotifications",
      "settingsDataSaver",
      "settingsPrivacy",
      "settingsSecurity",
      "about",
    ]),
  },
];

export const NAV_DEF_LOGGED_OUT: NavEntry[] = [
  {
    id: "public",
    heading: "公開",
    items: [
      { id: "publicRegulations", href: "/regulations", iconKey: "regulations", label: "法規查詢" },
      { id: "publicDocuments", href: "/documents", iconKey: "documents", label: "公文查詢" },
      { id: "publicAnnouncements", href: "/announcements", iconKey: "announcement", label: "校內公告" },
      { id: "publicPartnerMap", href: "/partner-map", iconKey: "partnerMap", label: "特約地圖" },
      { id: "publicPetition", href: "/petitions/new", iconKey: "petition", label: "我要陳情" },
      { id: "publicCouncilProposal", href: "/council-proposals", iconKey: "meetings", label: "議會提案" },
      { id: "publicJudicialPetition", href: "/judicial-petitions", iconKey: "shield", label: "評議訴訟" },
      { id: "publicAbout", href: "/about", iconKey: "info", label: "關於本系統" },
    ],
  },
];

export const DEFAULT_DESKTOP_ORDER = NAV_ITEMS.map((item) => item.id);
export const DEFAULT_MOBILE_ORDER = [
  "dashboard",
  "tasks",
  "calendar",
  "councilProposals",
  "documents",
  "regulations",
  "judicialPetitions",
  "examPapers",
  "meal",
  "shop",
  "shopOrders",
  "surveys",
  "announcements",
  "partnerMap",
  "petitions",
  "settingsNavigation",
  "settingsDataSaver",
  "settingsPrivacy",
];

export const DEFAULT_NAV_PREFERENCES: NavPreferences = {
  desktopOrder: DEFAULT_DESKTOP_ORDER,
  desktopHidden: [],
  mobileOrder: DEFAULT_MOBILE_ORDER,
  mobileHidden: [],
};

export const NAV_PREF_EVENT = "hcca:navigation-preferences-changed";

function byIds(ids: string[]) {
  return ids.map((id) => NAV_ITEMS_BY_ID[id]).filter(Boolean);
}

export function isSection(entry: NavEntry): entry is NavSection {
  return "heading" in entry;
}

export function navPrefsStorageKey() {
  if (typeof window === "undefined") return "hcca.nav.preferences:anonymous";
  const userId = window.localStorage.getItem("user_id") ?? "anonymous";
  return `hcca.nav.preferences:${userId}`;
}

export function readNavPreferences(): NavPreferences {
  if (typeof window === "undefined") return DEFAULT_NAV_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(navPrefsStorageKey());
    if (!raw) return DEFAULT_NAV_PREFERENCES;
    return normalizeNavPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_NAV_PREFERENCES;
  }
}

export function hasSavedNavPreferences() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(navPrefsStorageKey()) !== null;
}

export function writeNavPreferences(prefs: NavPreferences) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(navPrefsStorageKey(), JSON.stringify(normalizeNavPreferences(prefs)));
  window.dispatchEvent(new Event(NAV_PREF_EVENT));
}

export function normalizeNavPreferences(value: Partial<NavPreferences> | null): NavPreferences {
  const desktopOrder = normalizeOrder(value?.desktopOrder, DEFAULT_DESKTOP_ORDER);
  const mobileOrder = normalizeOrder(value?.mobileOrder, DEFAULT_MOBILE_ORDER);
  return {
    desktopOrder,
    mobileOrder,
    desktopHidden: normalizeHidden(value?.desktopHidden),
    mobileHidden: normalizeHidden(value?.mobileHidden),
  };
}

export function orderedItems(order: string[], hidden: string[], availableItems = NAV_ITEMS) {
  const available = new Map(availableItems.map((item) => [item.id, item]));
  const hiddenSet = new Set(hidden);
  const ids = normalizeOrder(order, availableItems.map((item) => item.id));
  return ids.map((id) => available.get(id)).filter((item): item is NavItem => !!item && !hiddenSet.has(item.id));
}

export function filterNavItems(
  items: NavItem[],
  can: (code: string) => boolean,
  hasPrefix: (prefix: string) => boolean,
) {
  return items.filter((item) => {
    if (!item.perm) return true;
    if (item.perm.endsWith(":*")) return hasPrefix(item.perm.slice(0, -1));
    return can(item.perm);
  });
}

function normalizeOrder(value: unknown, fallback: string[]) {
  const ids = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  const validIds = new Set(fallback);
  const seen = new Set<string>();
  const ordered = ids.filter((id) => {
    if (!validIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return [...ordered, ...fallback.filter((id) => !seen.has(id))];
}

function normalizeHidden(value: unknown) {
  if (!Array.isArray(value)) return [];
  const validIds = new Set(NAV_ITEMS.map((item) => item.id));
  return value.filter((id): id is string => typeof id === "string" && validIds.has(id));
}
