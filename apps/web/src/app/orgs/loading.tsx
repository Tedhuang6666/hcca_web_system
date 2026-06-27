import { PageLoading } from "@/components/ui/LoadingState";

export default function OrgsLoading() {
  return (
    <PageLoading title="組織載入中" description="正在讀取組織樹與職位資訊。" rows={6} showFilters={false} />
  );
}
