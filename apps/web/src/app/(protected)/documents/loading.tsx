import { PageLoading } from "@/components/ui/LoadingState";

export default function DocumentsLoading() {
  return <PageLoading title="公文載入中" description="正在整理公文清單與簽核狀態。" rows={6} />;
}
