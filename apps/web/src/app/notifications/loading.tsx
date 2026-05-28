import { ListPageSkeleton } from "@/components/ui/Skeleton";

export default function NotificationsLoading() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <ListPageSkeleton rows={6} />
    </div>
  );
}
