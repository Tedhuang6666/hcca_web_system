import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function MealLoading() {
  return (
    <div className="max-w-5xl mx-auto p-6">
      <ListPageSkeleton rows={4} />
    </div>
  );
}
