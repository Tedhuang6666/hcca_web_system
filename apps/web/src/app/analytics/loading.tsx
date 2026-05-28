import { SectionSkeleton } from "@/components/ui/Skeleton";

export default function AnalyticsLoading() {
  return (
    <div className="max-w-6xl mx-auto p-6 grid gap-4 lg:grid-cols-2">
      <SectionSkeleton lines={6} />
      <SectionSkeleton lines={6} />
      <SectionSkeleton lines={4} />
      <SectionSkeleton lines={4} />
    </div>
  );
}
