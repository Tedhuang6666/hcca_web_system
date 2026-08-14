import { PageLoading } from "@/components/ui/LoadingState";

export default function ShopLoading() {
  return (
    <PageLoading
      title="購票載入中"
      description="正在讀取商品、票券與訂單狀態。"
      rows={4}
      showFilters={false}
    />
  );
}
