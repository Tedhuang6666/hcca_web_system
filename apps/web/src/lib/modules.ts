// 前端功能模組登錄 — 與後端 apps/api/src/api/core/modules.py 對齊。
// 用於：依 pathname 判斷所屬模組（AppShell 維護插頁）、nav 徽章對照。

export type ModuleId =
  | "documents"
  | "regulations"
  | "meetings"
  | "councilProposals"
  | "judicialPetitions"
  | "announcements"
  | "shop"
  | "meal"
  | "surveys"
  | "petitions"
  | "examPapers"
  | "partnerMap"
  | "governance"
  | "activities"
  | "elections"
  | "seating";

export interface FeModuleSpec {
  label: string;
  routePrefixes: string[];
  navIds: string[];
}

export const FE_MODULES: Record<ModuleId, FeModuleSpec> = {
  documents: {
    label: "公文系統",
    routePrefixes: ["/documents", "/document-templates", "/serial-templates"],
    navIds: ["documents", "documentTemplates", "serialTemplates"],
  },
  regulations: { label: "法規系統", routePrefixes: ["/regulations"], navIds: ["regulations"] },
  meetings: {
    label: "議事系統",
    routePrefixes: ["/meetings", "/calendar"],
    navIds: ["meetings", "calendar"],
  },
  councilProposals: {
    label: "議會提案",
    routePrefixes: ["/council-proposals"],
    navIds: ["councilProposals"],
  },
  judicialPetitions: {
    label: "評議訴訟",
    routePrefixes: ["/judicial-petitions"],
    navIds: ["judicialPetitions"],
  },
  announcements: {
    label: "校內公告",
    routePrefixes: ["/announcements"],
    navIds: ["announcements"],
  },
  shop: {
    label: "校商訂購",
    routePrefixes: ["/shop"],
    navIds: ["shop", "shopOrders", "shopAdmin"],
  },
  meal: { label: "學餐訂購", routePrefixes: ["/meal"], navIds: ["meal", "mealVendor"] },
  surveys: { label: "問卷系統", routePrefixes: ["/surveys"], navIds: ["surveys"] },
  petitions: {
    label: "陳情中心",
    routePrefixes: ["/petitions"],
    navIds: ["petitions", "petitionsManage"],
  },
  examPapers: {
    label: "段考題庫",
    routePrefixes: ["/exam-papers"],
    navIds: ["examPapers", "examPaperAdmin"],
  },
  partnerMap: {
    label: "特約地圖",
    routePrefixes: ["/partner-map"],
    navIds: ["partnerMap", "partnerMapAdmin"],
  },
  governance: {
    label: "治理中樞",
    routePrefixes: ["/governance"],
    navIds: ["governanceHub"],
  },
  activities: {
    label: "活動管理",
    routePrefixes: ["/activities"],
    navIds: ["activitiesAdmin"],
  },
  elections: {
    label: "選舉開票",
    routePrefixes: ["/elections"],
    navIds: ["electionsAdmin"],
  },
  seating: {
    label: "票務劃位",
    routePrefixes: ["/seating"],
    navIds: [],
  },
};

// 較長前綴優先，避免短前綴誤判。
const ROUTE_INDEX: Array<[string, ModuleId]> = Object.entries(FE_MODULES)
  .flatMap(([id, spec]) => spec.routePrefixes.map((p) => [p, id as ModuleId] as [string, ModuleId]))
  .sort((a, b) => b[0].length - a[0].length);

/** 依 pathname 找所屬模組（segment 邊界）；無對應回 null。 */
export function moduleForPath(pathname: string): ModuleId | null {
  for (const [prefix, id] of ROUTE_INDEX) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return id;
  }
  return null;
}

// navId -> moduleId（給 Sidebar 徽章用）。
export const NAV_ID_TO_MODULE: Record<string, ModuleId> = Object.entries(FE_MODULES).reduce(
  (acc, [id, spec]) => {
    for (const navId of spec.navIds) acc[navId] = id as ModuleId;
    return acc;
  },
  {} as Record<string, ModuleId>,
);
