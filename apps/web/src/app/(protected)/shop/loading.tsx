import { PageLoading } from "@/components/ui/LoadingState";

export default function ShopLoading() {
  return (
    <PageLoading
      title="商品訂購載入中"
      rows={4}
      showFilters={false}
    />
  );
}
