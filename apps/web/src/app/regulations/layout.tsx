import ModuleBoundary from "@/components/ModuleBoundary";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function RegulationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleBoundary id="regulations" skeleton={<ListPageSkeleton />}>
      {children}
    </ModuleBoundary>
  );
}
