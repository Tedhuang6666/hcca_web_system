import { PageLoading } from "@/components/ui/LoadingState";

export default function AuditLogsLoading() {
  return <PageLoading title="稽核紀錄載入中" description="正在查詢操作紀錄與追蹤資訊。" rows={8} />;
}
