import { PageLoading } from "@/components/ui/LoadingState";

export default function TasksLoading() {
  return (
    <PageLoading title="任務載入中" rows={5} showFilters={false} />
  );
}
