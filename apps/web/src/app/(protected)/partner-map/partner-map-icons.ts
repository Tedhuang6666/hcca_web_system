import {
  Accessibility,
  Apple,
  Baby,
  BedDouble,
  Beer,
  Bike,
  BookOpen,
  BriefcaseBusiness,
  Candy,
  CakeSlice,
  Camera,
  Car,
  ChefHat,
  Coffee,
  Cookie,
  CookingPot,
  Croissant,
  CupSoda,
  Drumstick,
  Dumbbell,
  EggFried,
  Fish,
  Flame,
  Flower2,
  Fuel,
  Gamepad2,
  Gift,
  GlassWater,
  GraduationCap,
  Hamburger,
  HeartPulse,
  HeartHandshake,
  Home,
  Hotel,
  IceCreamBowl,
  Laptop,
  Milk,
  Music,
  PawPrint,
  PartyPopper,
  Pizza,
  Pill,
  Popcorn,
  Printer,
  Salad,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Soup,
  Smartphone,
  Sparkles,
  Sprout,
  Store,
  Ticket,
  TrainFront,
  UtensilsCrossed,
  WalletCards,
  WashingMachine,
  Wine,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type PartnerIconKey =
  | "store"
  | "uniform"
  | "clothing"
  | "shopping"
  | "supermarket"
  | "food"
  | "drink"
  | "bubble_tea"
  | "coffee"
  | "juice"
  | "milk"
  | "breakfast"
  | "fried_food"
  | "fast_food"
  | "burger"
  | "pizza"
  | "noodle"
  | "hot_pot"
  | "bento"
  | "barbecue"
  | "seafood"
  | "salad"
  | "fresh_food"
  | "dessert"
  | "ice_cream"
  | "bakery"
  | "cake"
  | "candy"
  | "snack"
  | "cookie"
  | "bar"
  | "wine"
  | "stationery"
  | "education"
  | "copy"
  | "computer"
  | "mobile"
  | "fitness"
  | "health"
  | "pharmacy"
  | "beauty"
  | "repair"
  | "laundry"
  | "home"
  | "transport"
  | "bike"
  | "car"
  | "fuel"
  | "music"
  | "camera"
  | "ticket"
  | "event"
  | "gift"
  | "flowers"
  | "plants"
  | "pets"
  | "baby"
  | "games"
  | "hotel"
  | "accommodation"
  | "finance"
  | "accessibility"
  | "cleaning"
  | "community";

export const PARTNER_ICON_OPTIONS: Array<{ key: PartnerIconKey; label: string; icon: LucideIcon }> = [
  { key: "store", label: "一般商店", icon: Store },
  { key: "uniform", label: "制服", icon: Shirt },
  { key: "clothing", label: "衣服服飾", icon: ShoppingBag },
  { key: "shopping", label: "零售購物", icon: BriefcaseBusiness },
  { key: "supermarket", label: "超商超市", icon: ShoppingBasket },
  { key: "food", label: "食物餐飲", icon: UtensilsCrossed },
  { key: "drink", label: "飲料咖啡", icon: Coffee },
  { key: "bubble_tea", label: "手搖飲", icon: CupSoda },
  { key: "coffee", label: "咖啡店", icon: Coffee },
  { key: "juice", label: "果汁冰沙", icon: GlassWater },
  { key: "milk", label: "鮮奶豆漿", icon: Milk },
  { key: "breakfast", label: "早餐早午餐", icon: EggFried },
  { key: "fried_food", label: "炸物鹽酥雞", icon: Drumstick },
  { key: "fast_food", label: "速食", icon: Soup },
  { key: "burger", label: "漢堡", icon: Hamburger },
  { key: "pizza", label: "披薩", icon: Pizza },
  { key: "noodle", label: "麵食", icon: Soup },
  { key: "hot_pot", label: "火鍋鍋物", icon: CookingPot },
  { key: "bento", label: "便當飯食", icon: ChefHat },
  { key: "barbecue", label: "燒烤串燒", icon: Flame },
  { key: "seafood", label: "海鮮壽司", icon: Fish },
  { key: "salad", label: "沙拉健康餐", icon: Salad },
  { key: "fresh_food", label: "水果生鮮", icon: Apple },
  { key: "dessert", label: "甜點蛋糕", icon: CakeSlice },
  { key: "ice_cream", label: "冰品冰淇淋", icon: IceCreamBowl },
  { key: "bakery", label: "麵包烘焙", icon: Croissant },
  { key: "cake", label: "蛋糕店", icon: CakeSlice },
  { key: "candy", label: "糖果零食", icon: Candy },
  { key: "snack", label: "餅乾爆米花", icon: Popcorn },
  { key: "cookie", label: "餅乾點心", icon: Cookie },
  { key: "bar", label: "酒吧酒品", icon: Beer },
  { key: "wine", label: "葡萄酒品", icon: Wine },
  { key: "stationery", label: "文具書籍", icon: BookOpen },
  { key: "education", label: "補習教育", icon: GraduationCap },
  { key: "copy", label: "影印印刷", icon: Printer },
  { key: "computer", label: "電腦 3C", icon: Laptop },
  { key: "mobile", label: "手機通訊", icon: Smartphone },
  { key: "fitness", label: "運動健身", icon: Dumbbell },
  { key: "health", label: "診所健康", icon: HeartPulse },
  { key: "pharmacy", label: "藥局保健", icon: Pill },
  { key: "beauty", label: "美容美髮", icon: Scissors },
  { key: "repair", label: "維修服務", icon: Wrench },
  { key: "laundry", label: "洗衣清潔", icon: WashingMachine },
  { key: "home", label: "居家生活", icon: Home },
  { key: "transport", label: "交通車站", icon: TrainFront },
  { key: "bike", label: "自行車", icon: Bike },
  { key: "car", label: "汽車服務", icon: Car },
  { key: "fuel", label: "加油充電", icon: Fuel },
  { key: "music", label: "音樂樂器", icon: Music },
  { key: "camera", label: "攝影影像", icon: Camera },
  { key: "ticket", label: "票券活動", icon: Ticket },
  { key: "event", label: "派對活動", icon: PartyPopper },
  { key: "gift", label: "禮品伴手禮", icon: Gift },
  { key: "flowers", label: "花藝植栽", icon: Flower2 },
  { key: "plants", label: "花草園藝", icon: Sprout },
  { key: "pets", label: "寵物", icon: PawPrint },
  { key: "baby", label: "親子用品", icon: Baby },
  { key: "games", label: "遊戲桌遊", icon: Gamepad2 },
  { key: "hotel", label: "住宿旅館", icon: Hotel },
  { key: "accommodation", label: "民宿房間", icon: BedDouble },
  { key: "finance", label: "金融保險", icon: WalletCards },
  { key: "accessibility", label: "無障礙服務", icon: Accessibility },
  { key: "cleaning", label: "清潔整理", icon: Sparkles },
  { key: "community", label: "社群公益", icon: HeartHandshake },
];

const ICON_MAP = new Map(PARTNER_ICON_OPTIONS.map((option) => [option.key, option.icon]));

const ICON_KEY_BY_TEXT: Array<[RegExp, PartnerIconKey]> = [
  [/制服/, "uniform"],
  [/衣服|服飾|成衣|鞋/, "clothing"],
  [/超商|便利商店|超市|量販|雜貨/, "supermarket"],
  [/零售|購物|商店|百貨/, "shopping"],
  [/手搖|手摇|珍珠奶茶|奶茶|茶飲|飲料店/, "bubble_tea"],
  [/咖啡|拿鐵|美式|cafe/i, "coffee"],
  [/果汁|果茶|果昔|冰沙/, "juice"],
  [/鮮奶|牛奶|豆漿|乳品/, "milk"],
  [/飲料|茶/, "drink"],
  [/早餐|早午餐|蛋餅|飯糰|吐司/, "breakfast"],
  [/炸物|鹽酥雞|炸雞|雞排|薯條|雞塊|炸蝦/, "fried_food"],
  [/披薩|pizza/i, "pizza"],
  [/漢堡/, "burger"],
  [/速食|三明治/, "fast_food"],
  [/麵|拉麵|牛肉麵|麵線|意麵/, "noodle"],
  [/火鍋|鍋物|麻辣燙/, "hot_pot"],
  [/便當|自助餐|丼飯|咖哩飯|燒肉飯/, "bento"],
  [/燒烤|烤肉|串燒|烤鴨/, "barbecue"],
  [/海鮮|水產|壽司|生魚片/, "seafood"],
  [/沙拉|健康餐|蔬食|素食/, "salad"],
  [/水果|生鮮|蔬果|農產品/, "fresh_food"],
  [/冰淇淋|霜淇淋|雪花冰|冰品/, "ice_cream"],
  [/麵包|烘焙|烘培|可頌/, "bakery"],
  [/蛋糕/, "cake"],
  [/甜點/, "dessert"],
  [/糖果/, "candy"],
  [/餅乾|曲奇|點心/, "cookie"],
  [/零食|爆米花/, "snack"],
  [/酒吧|啤酒|酒品/, "bar"],
  [/葡萄酒|紅酒|白酒|威士忌/, "wine"],
  [/食物|餐飲|小吃|定食|午餐|晚餐/, "food"],
  [/文具|書局|書店/, "stationery"],
  [/補習|教育|家教/, "education"],
  [/影印|印刷/, "copy"],
  [/手機|通訊|行動裝置/, "mobile"],
  [/電腦|3C|資訊|電子/, "computer"],
  [/健身|運動/, "fitness"],
  [/診所|醫療|健康/, "health"],
  [/藥局|保健/, "pharmacy"],
  [/美容|美髮|美甲/, "beauty"],
  [/洗衣|自助洗衣|乾洗/, "laundry"],
  [/維修|修理|修繕|鎖店/, "repair"],
  [/加油站|充電站|電動車/, "fuel"],
  [/汽車|車行|汽修/, "car"],
  [/自行車|單車/, "bike"],
  [/交通|車站|公車|捷運/, "transport"],
  [/花店|花藝|植栽/, "flowers"],
  [/花草|園藝|盆栽/, "plants"],
  [/音樂|樂器|琴行/, "music"],
  [/攝影|相機|影像/, "camera"],
  [/票券|活動|展覽/, "ticket"],
  [/派對|慶典|演唱會/, "event"],
  [/禮品|伴手禮|紀念品/, "gift"],
  [/寵物|貓|狗/, "pets"],
  [/親子|嬰兒|婦幼/, "baby"],
  [/遊戲|桌遊|電競|玩具/, "games"],
  [/住宿|旅館|飯店/, "hotel"],
  [/民宿|房間|旅店/, "accommodation"],
  [/銀行|金融|保險|理財/, "finance"],
  [/無障礙|輔具/, "accessibility"],
  [/清潔|清洗|整理/, "cleaning"],
  [/社群|公益|協會|基金會/, "community"],
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
