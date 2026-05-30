import ModuleBoundary from "@/components/ModuleBoundary";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function MeetingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleBoundary id="meetings" skeleton={<ListPageSkeleton />}>
      {children}
    </ModuleBoundary>
  );
}
