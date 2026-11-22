import type { UnifiedMapItem } from "@/lib/partner-map-types";

export type PartnerMapBoundsState = {
  min_lat: string;
  max_lat: string;
  min_lng: string;
  max_lng: string;
};

export type MarkerKind =
  | "all"
  | "drink"
  | "breakfast"
  | "fast_food"
  | "noodle"
  | "uniform"
  | "retail"
  | "fitness"
  | "health"
  | "beauty"
  | "repair"
  | "stationery"
  | "cram_school"
  | "copy"
  | "meal"
  | "other";

export const MARKER_CONFIG: Record<Exclude<MarkerKind, "all">, { label: string; color: string }> = {
  drink: { label: "飲料", color: "#EC4899" },
  breakfast: { label: "早餐", color: "#F97316" },
  fast_food: { label: "速食", color: "#EF4444" },
  noodle: { label: "麵店", color: "#F59E0B" },
  uniform: { label: "制服", color: "#0F766E" },
  retail: { label: "零售", color: "#DB2777" },
  fitness: { label: "運動", color: "#2563EB" },
  health: { label: "健康", color: "#059669" },
  beauty: { label: "美容", color: "#C026D3" },
  repair: { label: "維修", color: "#7C3AED" },
  stationery: { label: "文具", color: "#8B5CF6" },
  cram_school: { label: "補習班", color: "#3B82F6" },
  copy: { label: "影印", color: "#64748B" },
  meal: { label: "餐飲", color: "#10B981" },
  other: { label: "特約", color: "#C9A84C" },
};

export function markerKind(item: UnifiedMapItem): Exclude<MarkerKind, "all"> {
  const text = [
    item.business_name,
    item.summary ?? "",
    item.category ?? "",
    ...item.tags.map((tag) => tag.name),
  ].join(" ");
  if (/飲料|手搖|茶|咖啡|果汁|冰品|豆花/.test(text)) return "drink";
  if (/早餐|早午餐|蛋餅|飯糰|吐司|漢堡蛋/.test(text)) return "breakfast";
  if (/速食|漢堡|炸雞|披薩|薯條|三明治/.test(text)) return "fast_food";
  if (/麵|拉麵|牛肉麵|乾麵|湯麵|麵線|意麵/.test(text)) return "noodle";
  if (/制服|服飾|成衣|鞋|衣服|皮件|修改衣/.test(text)) return "uniform";
  if (/商店|零售|百貨|購物|雜貨|超商|生活用品/.test(text)) return "retail";
  if (/健身|運動|體育|瑜珈/.test(text)) return "fitness";
  if (/診所|藥局|牙醫|醫療|健康/.test(text)) return "health";
  if (/美髮|髮廊|美容|美甲|美妝/.test(text)) return "beauty";
  if (/修理|維修|洗衣|鎖店/.test(text)) return "repair";
  if (/文具|書局|筆|紙|美術|用品/.test(text)) return "stationery";
  if (/補習|升學|家教|英文|數學|物理|化學/.test(text)) return "cram_school";
  if (/影印|列印|印刷|輸出|裝訂/.test(text)) return "copy";
  if (/餐|飯|便當|小吃|滷味|鍋|早餐|午餐|晚餐/.test(text)) return "meal";
  return "other";
}

function safeMarkerColor(value: string | null | undefined, fallback: string): string {
  const color = value?.trim() ?? "";
  return /^#[\da-f]{3,8}$/i.test(color) ? color : fallback;
}

export function markerLabel(item: UnifiedMapItem): string {
  if (item.source === "recommended") return "推薦商家";
  return item.category?.trim() || item.tags.find((tag) => tag.name.trim())?.name.trim() || MARKER_CONFIG[markerKind(item)].label;
}

export function markerColor(item: UnifiedMapItem): string {
  if (item.source === "recommended") return "#2563EB";
  const fallback = MARKER_CONFIG[markerKind(item)].color;
  return safeMarkerColor(item.tags.find((tag) => tag.color)?.color, fallback);
}
