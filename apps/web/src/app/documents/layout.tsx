import ModuleBoundary from "@/components/ModuleBoundary";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleBoundary id="documents" skeleton={<ListPageSkeleton />}>
      {children}
    </ModuleBoundary>
  );
}
