import { PageLoading } from "@/components/ui/LoadingState";

export default function TasksLoading() {
  return (
    <PageLoading title="任務載入中" description="正在同步待辦與處理狀態。" rows={5} showFilters={false} />
  );
}
