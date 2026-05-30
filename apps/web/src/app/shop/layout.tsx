import ModuleBoundary from "@/components/ModuleBoundary";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleBoundary id="shop" skeleton={<ListPageSkeleton />}>
      {children}
    </ModuleBoundary>
  );
}
