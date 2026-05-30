import ModuleBoundary from "@/components/ModuleBoundary";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function ExamPapersLayout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleBoundary id="examPapers" skeleton={<ListPageSkeleton />}>
      {children}
    </ModuleBoundary>
  );
}
