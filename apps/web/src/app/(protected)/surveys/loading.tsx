import { PageLoading } from "@/components/ui/LoadingState";

export default function SurveysLoading() {
  return <PageLoading title="問卷載入中" description="正在載入問卷、回覆與統計摘要。" rows={5} />;
}
