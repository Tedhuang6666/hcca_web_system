import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function OrgsLoading() {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <ListPageSkeleton rows={6} showFilters={false} />
    </div>
  );
}
