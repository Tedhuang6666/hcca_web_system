import { SectionSkeleton } from "@/components/ui/Skeleton";

export default function DocumentDetailLoading() {
  return (
    <div className="space-y-4">
      <SectionSkeleton lines={2} />
      <SectionSkeleton lines={4} />
    </div>
  );
}
