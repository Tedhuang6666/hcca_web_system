import {
  BookOpenText,
  FileSearch,
  Handshake,
  Info,
  Landmark,
  Link2,
  ListChecks,
  Mail,
  MapPinned,
  Megaphone,
  MessageSquareText,
  Radio,
  Scale,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  news: Megaphone,
  articles: BookOpenText,
  about: Landmark,
  "system-info": Info,
  officers: UsersRound,
  contact: Mail,
  links: Link2,
  "public-db": BookOpenText,
  regulations: Scale,
  documents: FileSearch,
  elections: Radio,
  "special-agreement": Handshake,
  "partner-map": MapPinned,
  surveys: ListChecks,
  petitions: MessageSquareText,
};

export default function PublicNavIcon({ iconKey, size }: { iconKey: string; size: number }) {
  const Icon = ICONS[iconKey];
  return Icon ? <Icon size={size} aria-hidden /> : null;
}
