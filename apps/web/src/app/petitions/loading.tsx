import { PageLoading } from "@/components/ui/LoadingState";

export default function PetitionsLoading() {
  return <PageLoading title="陳情載入中" description="正在整理陳情案件與處理狀態。" rows={5} />;
}
