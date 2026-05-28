import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function SurveysLoading() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <ListPageSkeleton rows={5} />
    </div>
  );
}
