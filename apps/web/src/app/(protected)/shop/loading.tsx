import { PageLoading } from "@/components/ui/LoadingState";

export default function ShopLoading() {
  return (
    <PageLoading
      title="商品訂購載入中"
      description="正在讀取商品與訂單狀態。"
      rows={4}
      showFilters={false}
    />
  );
}
