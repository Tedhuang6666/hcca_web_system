import ModuleBoundary from "@/components/ModuleBoundary";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function SurveysLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleBoundary id="surveys" skeleton={<ListPageSkeleton />}>
      {children}
    </ModuleBoundary>
  );
}
