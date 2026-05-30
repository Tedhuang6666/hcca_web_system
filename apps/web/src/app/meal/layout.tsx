import ModuleBoundary from "@/components/ModuleBoundary";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function MealLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleBoundary id="meal" skeleton={<ListPageSkeleton />}>
      {children}
    </ModuleBoundary>
  );
}
