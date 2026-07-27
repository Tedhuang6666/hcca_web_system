import {
  Apple,
  Baby,
  Bike,
  BookOpen,
  BriefcaseBusiness,
  CakeSlice,
  Camera,
  Car,
  Coffee,
  Dumbbell,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Laptop,
  Music,
  PawPrint,
  Pill,
  Printer,
  Scissors,
  Shirt,
  ShoppingBag,
  Soup,
  Store,
  Ticket,
  TrainFront,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type PartnerIconKey =
  | "store"
  | "uniform"
  | "clothing"
  | "shopping"
  | "food"
  | "drink"
  | "breakfast"
  | "fast_food"
  | "noodle"
  | "dessert"
  | "stationery"
  | "education"
  | "copy"
  | "computer"
  | "fitness"
  | "health"
  | "pharmacy"
  | "beauty"
  | "repair"
  | "home"
  | "transport"
  | "bike"
  | "car"
  | "music"
  | "camera"
  | "ticket"
  | "gift"
  | "pets"
  | "baby";

export const PARTNER_ICON_OPTIONS: Array<{ key: PartnerIconKey; label: string; icon: LucideIcon }> = [
  { key: "store", label: "一般商店", icon: Store },
  { key: "uniform", label: "制服", icon: Shirt },
  { key: "clothing", label: "衣服服飾", icon: ShoppingBag },
  { key: "shopping", label: "零售購物", icon: BriefcaseBusiness },
  { key: "food", label: "食物餐飲", icon: UtensilsCrossed },
  { key: "drink", label: "飲料咖啡", icon: Coffee },
  { key: "breakfast", label: "早餐", icon: Apple },
  { key: "fast_food", label: "速食", icon: Soup },
  { key: "noodle", label: "麵食", icon: Soup },
  { key: "dessert", label: "甜點蛋糕", icon: CakeSlice },
  { key: "stationery", label: "文具書籍", icon: BookOpen },
  { key: "education", label: "補習教育", icon: GraduationCap },
  { key: "copy", label: "影印印刷", icon: Printer },
  { key: "computer", label: "電腦 3C", icon: Laptop },
  { key: "fitness", label: "運動健身", icon: Dumbbell },
  { key: "health", label: "診所健康", icon: HeartPulse },
  { key: "pharmacy", label: "藥局保健", icon: Pill },
  { key: "beauty", label: "美容美髮", icon: Scissors },
  { key: "repair", label: "維修服務", icon: Wrench },
  { key: "home", label: "居家生活", icon: Home },
  { key: "transport", label: "交通車站", icon: TrainFront },
  { key: "bike", label: "自行車", icon: Bike },
  { key: "car", label: "汽車服務", icon: Car },
  { key: "music", label: "音樂樂器", icon: Music },
  { key: "camera", label: "攝影影像", icon: Camera },
  { key: "ticket", label: "票券活動", icon: Ticket },
  { key: "gift", label: "禮品", icon: Gift },
  { key: "pets", label: "寵物", icon: PawPrint },
  { key: "baby", label: "親子用品", icon: Baby },
];

const ICON_MAP = new Map(PARTNER_ICON_OPTIONS.map((option) => [option.key, option.icon]));

const ICON_KEY_BY_TEXT: Array<[RegExp, PartnerIconKey]> = [
  [/制服/, "uniform"],
  [/衣服|服飾|成衣|鞋/, "clothing"],
  [/零售|購物|商店|百貨/, "shopping"],
  [/飲料|咖啡|茶/, "drink"],
  [/早餐/, "breakfast"],
  [/食物|餐飲|便當|小吃/, "food"],
  [/麵|拉麵/, "noodle"],
  [/甜點|蛋糕|冰品/, "dessert"],
  [/文具|書局|書店/, "stationery"],
  [/補習|教育|家教/, "education"],
  [/影印|印刷/, "copy"],
  [/健身|運動/, "fitness"],
  [/診所|醫療|健康/, "health"],
  [/藥局|保健/, "pharmacy"],
  [/美容|美髮|美甲/, "beauty"],
  [/維修|修理|洗衣/, "repair"],
  [/車|汽車/, "car"],
  [/自行車|單車/, "bike"],
];

export function getPartnerIcon(iconKey: string | null | undefined): LucideIcon {
  return ICON_MAP.get(iconKey as PartnerIconKey) ?? Store;
}

export function defaultPartnerIconKey(label: string | null | undefined): PartnerIconKey {
  const match = ICON_KEY_BY_TEXT.find(([pattern]) => pattern.test(label ?? ""));
  return match?.[1] ?? "store";
}

export function isPartnerIconKey(value: string | null | undefined): value is PartnerIconKey {
  return Boolean(value && ICON_MAP.has(value as PartnerIconKey));
}
