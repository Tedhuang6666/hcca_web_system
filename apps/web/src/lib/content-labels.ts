export const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  letter: "函",
  decree: "令",
  announcement: "公告",
  report: "報告",
  record: "紀錄",
  consultation: "咨",
  meeting_notice: "開會通知",
  other: "其他",
};

export const REGULATION_CATEGORY_LABELS: Record<string, string> = {
  constitution: "憲章",
  ordinance: "條例",
  procedure: "辦法",
};

export function contentCategoryLabel(
  category: string | null | undefined,
  labels: Record<string, string>,
  fallback: string,
) {
  return (category && labels[category]) || fallback;
}
