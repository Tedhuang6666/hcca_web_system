import { DetailPageLoading } from "@/components/ui/LoadingState";

export default function MeetingDetailLoading() {
  return <DetailPageLoading title="會議詳情載入中" description="正在取得議程、決議與出席資訊。" />;
}
