/**
 * 前端路由／模組的單一 metadata 來源。
 * 導覽仍可依角色排序，但公開性、Shell 與維護模組不得在多個檔案重複宣告。
 */
export const MODULE_MANIFEST = {
  documents: { label: "公文系統", routePrefixes: ["/documents", "/document-templates", "/serial-templates"], navIds: ["documents", "documentTemplates", "serialTemplates"], navigationGroup: "治理事務" },
  regulations: { label: "法規系統", routePrefixes: ["/regulations"], navIds: ["regulations"], navigationGroup: "治理事務" },
  meetings: { label: "議事系統", routePrefixes: ["/meetings"], navIds: ["meetings"], navigationGroup: "治理事務" },
  calendar: { label: "行事曆", routePrefixes: ["/calendar"], navIds: ["calendar"], navigationGroup: "我的工作" },
  councilProposals: { label: "議會提案", routePrefixes: ["/council-proposals"], navIds: ["councilProposals"], navigationGroup: "治理事務" },
  judicialPetitions: { label: "評議訴訟", routePrefixes: ["/judicial-petitions"], navIds: ["judicialPetitions"], navigationGroup: "治理事務" },
  announcements: { label: "校內公告", routePrefixes: ["/announcements"], navIds: ["announcements"], navigationGroup: "發布與營運" },
  shop: { label: "商品訂購", routePrefixes: ["/shop"], navIds: ["shop", "shopAdmin"], navigationGroup: "校園服務" },
  merchandiseSubmissions: { label: "校商投稿", routePrefixes: ["/merchandise-submissions"], navIds: ["merchandiseSubmissions", "merchandiseSubmissionsAdmin"], navigationGroup: "校園服務" },
  meal: { label: "學餐訂購", routePrefixes: ["/meal"], navIds: ["meal", "mealVendor"], navigationGroup: "校園服務" },
  surveys: { label: "問卷系統", routePrefixes: ["/surveys"], navIds: ["surveys"], navigationGroup: "校園服務" },
  petitions: { label: "陳情中心", routePrefixes: ["/petitions"], navIds: ["petitions", "petitionsManage"], navigationGroup: "治理事務" },
  examPapers: { label: "段考題庫", routePrefixes: ["/exam-papers"], navIds: ["examPapers", "examPaperAdmin"], navigationGroup: "校園服務" },
  partnerMap: { label: "特約地圖", routePrefixes: ["/partner-map"], navIds: ["partnerMap", "partnerMapAdmin"], navigationGroup: "校園服務" },
  recommendedVendors: { label: "推薦商家", routePrefixes: ["/recommended-vendors"], navIds: ["recommendedVendors", "recommendedVendorsAdmin"], navigationGroup: "校園服務" },
  line: { label: "LINE 通知", routePrefixes: ["/line"], navIds: [], navigationGroup: "發布與營運" },
  discord: { label: "Discord 機器人", routePrefixes: ["/discord", "/admin/discord"], navIds: ["discordAdmin"], navigationGroup: "發布與營運" },
  governance: { label: "治理中樞", routePrefixes: ["/governance"], navIds: ["governanceHub"], navigationGroup: "我的工作" },
  matters: { label: "整合工作台", routePrefixes: ["/matters"], navIds: ["matters"], navigationGroup: "我的工作" },
  activities: { label: "活動管理", routePrefixes: ["/activities", "/admin/activities"], navIds: ["activitiesAdmin"], navigationGroup: "發布與營運" },
  raffle: { label: "現場抽獎", routePrefixes: ["/raffle", "/admin/raffle"], navIds: ["raffleAdmin"], navigationGroup: "發布與營運" },
  elections: { label: "選舉開票", routePrefixes: ["/elections", "/admin/elections"], navIds: ["electionsAdmin"], navigationGroup: "治理事務" },
  seating: { label: "票務劃位", routePrefixes: ["/seating"], navIds: [], navigationGroup: "校園服務" },
  finance: { label: "財務與收款", routePrefixes: ["/finance", "/receivables"], navIds: ["finance", "receivables"], navigationGroup: "發布與營運" },
  publications: { label: "發布中心", routePrefixes: ["/publications"], navIds: ["publications"], navigationGroup: "發布與營運" },
  email: { label: "電子郵件", routePrefixes: ["/email"], navIds: ["email"], navigationGroup: "發布與營運" },
  operations: { label: "營運中心", routePrefixes: ["/operations", "/tasks", "/work-items", "/loans", "/inventory", "/admin/loans", "/admin/inventory"], navIds: ["operations", "workItems", "inventoryAdmin"], navigationGroup: "我的工作" },
} as const;

export const MODULE_IDS = Object.keys(MODULE_MANIFEST) as Array<keyof typeof MODULE_MANIFEST>;

export const PUBLIC_ROUTE_MANIFEST = {
  prefixes: ["/about", "/auth", "/legal", "/links", "/live", "/login", "/maintenance", "/module-status", "/news", "/officers", "/pages", "/public", "/unsubscribe"],
  exact: ["/", "/announcements", "/documents", "/partner-map", "/petitions", "/petitions/new", "/petitions/share", "/petitions/public", "/profile/complete", "/regulations", "/surveys", "/blocked", "/contact", "/system-info"],
  patterns: [
    /^\/announcements\/(?!new$)[^/]+$/,
    /^\/documents\/(?!new$|delegations$)[^/]+$/,
    /^\/meetings\/(?:join|screen)\/[^/]+$/,
    /^\/partner-map\/(?!admin(?:\/|$)|my-businesses(?:\/|$))[^/]+$/,
    /^\/regulations\/(?!new(?:\/|$)|pending(?:\/|$)|archived(?:\/|$))[^/]+(?:\/(?!edit(?:\/|$)|amendment(?:\/|$)).*)?$/,
    /^\/surveys\/(?!new$)[^/]+$/,
    /^\/petitions\/public\/[^/]+$/,
    /^\/petitions\/[^/]+\/\d+$/,
  ],
} as const;

export const ROUTE_MANIFEST = [
  { group: "我的工作", routePrefixes: ["/dashboard", "/tasks", "/work-items", "/calendar", "/matters", "/governance"], public: false, shell: true },
  { group: "治理事務", routePrefixes: ["/documents", "/regulations", "/meetings", "/council-proposals", "/judicial-petitions", "/petitions"], public: false, shell: true },
  { group: "校園服務", routePrefixes: ["/meal", "/shop", "/surveys", "/partner-map", "/recommended-vendors", "/exam-papers", "/credential"], public: false, shell: true },
  { group: "發布與營運", routePrefixes: ["/announcements", "/publications", "/email", "/finance", "/operations"], public: false, shell: true },
  { group: "系統管理", routePrefixes: ["/admin", "/orgs", "/settings", "/audit-logs"], public: false, shell: true },
  { group: "公開內容", routePrefixes: PUBLIC_ROUTE_MANIFEST.prefixes, public: true, shell: false },
] as const;
