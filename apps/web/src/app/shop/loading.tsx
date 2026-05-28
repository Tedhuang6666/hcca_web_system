import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function ShopLoading() {
  return (
    <div className="max-w-6xl mx-auto p-6">
      <ListPageSkeleton rows={4} showFilters={false} />
    </div>
  );
}
