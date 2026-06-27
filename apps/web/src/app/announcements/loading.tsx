import { PageLoading } from "@/components/ui/LoadingState";

export default function AnnouncementsLoading() {
  return <PageLoading title="公告載入中" description="正在取得最新公告與發布狀態。" rows={5} />;
}
