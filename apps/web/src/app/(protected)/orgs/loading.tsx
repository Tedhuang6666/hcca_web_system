import { PageLoading } from "@/components/ui/LoadingState";

export default function OrgsLoading() {
  return (
    <PageLoading title="組織載入中" rows={6} showFilters={false} />
  );
}
