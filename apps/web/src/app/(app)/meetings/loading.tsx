import { PageLoading } from "@/components/ui/LoadingState";

export default function MeetingsLoading() {
  return <PageLoading title="會議載入中" description="正在整理會議、議程與出席資訊。" rows={5} />;
}
