"use client";

import {
  BarChart3,
  Barcode,
  Bell,
  BookOpen,
  CalendarDays,
  GraduationCap,
  CheckSquare,
  ClipboardList,
  FileText,
  Files,
  Inbox,
  Info,
  Landmark,
  LayoutGrid,
  Lock,
  Mail,
  MapPinned,
  MessageCircle,
  MessageSquare,
  Network,
  Settings,
  Shield,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Utensils,
  Vote,
  Warehouse,
  WifiOff,
} from "lucide-react";

type IconProps = { size: number; "aria-hidden": boolean };

const Icons: Record<string, React.ComponentType<IconProps>> = {
  dashboard: LayoutGrid,
  documents: FileText,
  documentTemplates: Files,
  calendar: CalendarDays,
  regulations: BookOpen,
  examPapers: GraduationCap,
  examPaperAdmin: GraduationCap,
  meetings: Landmark,
  serial: Barcode,
  shop: ShoppingCart,
  shopAdmin: Warehouse,
  shopOrders: Store,
  meal: Utensils,
  mealVendor: Truck,
  survey: CheckSquare,
  announcement: MessageCircle,
  petition: MessageSquare,
  email: Mail,
  permissions: Lock,
  people: Users,
  audit: ClipboardList,
  org: Network,
  classes: Users,
  analytics: BarChart3,
  partnerMap: MapPinned,
  elections: Vote,
  tasks: Inbox,
  governance: Network,
  systemDefense: Shield,
  settings: Settings,
  bell: Bell,
  wifiOff: WifiOff,
  shield: Shield,
  info: Info,
};

export default function NavIcon({ iconKey, size }: { iconKey: string; size: number }) {
  const Icon = Icons[iconKey];
  if (!Icon) return null;
  return <Icon size={size} aria-hidden={true} />;
}
