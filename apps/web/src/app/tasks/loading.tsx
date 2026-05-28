import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function TasksLoading() {
  return (
    <div className="max-w-5xl mx-auto p-6">
      <ListPageSkeleton rows={5} showFilters={false} />
    </div>
  );
}
