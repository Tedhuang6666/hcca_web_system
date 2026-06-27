import { DetailPageLoading } from "@/components/ui/LoadingState";

export default function DocumentDetailLoading() {
  return <DetailPageLoading title="公文詳情載入中" description="正在取得簽核、附件與版本紀錄。" />;
}
