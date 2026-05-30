import ModuleBoundary from "@/components/ModuleBoundary";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function AnnouncementsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleBoundary id="announcements" skeleton={<ListPageSkeleton />}>
      {children}
    </ModuleBoundary>
  );
}
