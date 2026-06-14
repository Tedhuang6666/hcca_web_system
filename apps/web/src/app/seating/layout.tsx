import ModuleBoundary from "@/components/ModuleBoundary";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function SeatingLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleBoundary id="seating" skeleton={<ListPageSkeleton />}>
      {children}
    </ModuleBoundary>
  );
}
