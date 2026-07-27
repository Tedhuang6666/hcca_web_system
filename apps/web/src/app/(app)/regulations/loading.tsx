import { PageLoading } from "@/components/ui/LoadingState";

export default function RegulationsLoading() {
  return <PageLoading title="法規載入中" description="正在載入法規索引與版本資訊。" rows={6} />;
}
