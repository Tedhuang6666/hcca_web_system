import ModuleBoundary from "@/components/ModuleBoundary";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function PartnerMapLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleBoundary id="partnerMap" skeleton={<ListPageSkeleton />}>
      {children}
    </ModuleBoundary>
  );
}
