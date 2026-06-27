import { LoadingState } from "@/components/ui/LoadingState";
import { SectionSkeleton } from "@/components/ui/Skeleton";

export default function AnalyticsLoading() {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5">
        <LoadingState title="分析載入中" description="正在彙整治理指標與趨勢資料。" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionSkeleton lines={6} />
        <SectionSkeleton lines={6} />
        <SectionSkeleton lines={4} />
        <SectionSkeleton lines={4} />
      </div>
    </div>
  );
}
