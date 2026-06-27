import { PageLoading } from "@/components/ui/LoadingState";

export default function MealLoading() {
  return <PageLoading title="學餐載入中" description="正在同步菜單、訂單與供應商資訊。" rows={4} />;
}
