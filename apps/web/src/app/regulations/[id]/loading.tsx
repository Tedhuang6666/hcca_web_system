import { SectionSkeleton } from "@/components/ui/Skeleton";

export default function RegulationDetailLoading() {
  return (
    <div className="space-y-4">
      <SectionSkeleton lines={3} />
      <SectionSkeleton lines={5} />
    </div>
  );
}
