import { PageLoading } from "@/components/ui/LoadingState";

export default function NotificationsLoading() {
  return (
    <PageLoading
      title="通知載入中"
      description="正在同步你的通知與已讀狀態。"
      rows={6}
      showFilters={false}
    />
  );
}
