import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function DocumentsLoading() {
  return (
    <div className="max-w-6xl mx-auto p-6">
      <ListPageSkeleton rows={6} />
    </div>
  );
}
