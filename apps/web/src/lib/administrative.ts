import type { RegulationArticleOut, RegulationListItem } from "./types";

export const REGULATION_CATEGORIES = {
  constitution: "組織章程",
  ordinance: "自治條例",
  procedure: "自治辦法",
} as const;

export const DOCUMENT_CATEGORIES: Record<string, string> = {
  letter: "函", decree: "令", announcement: "公告", presentation: "呈",
  report: "報告", record: "紀錄", consultation: "咨", meeting_notice: "開會通知單",
  inspection_notice: "會勘通知單", phone_record: "公務電話紀錄", book_letter: "書函",
  directive: "手令", signature: "簽", memo: "便簽", appointment: "聘書",
  certificate: "證明書", license: "證書／執照", contract: "契約書", proposal: "提案",
  summary: "節略", briefing: "說帖", form: "定型化表單", other: "其他",
};

/** 公示日期一律依臺北時區，缺值不以其他事件日期代替。 */
export function administrativeDate(value: string | null | undefined, long = false): string {
  if (!value) return "未載明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未載明";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  const year = Number(part("year")) - 1911;
  return long
    ? `中華民國${year}年${Number(part("month"))}月${Number(part("day"))}日`
    : `${year}.${part("month")}.${part("day")}`;
}

/** 章、節、項、款、目都不是「條」，已刪除條文不計入。 */
export function countLawArticles(articles: RegulationArticleOut[]): number {
  return articles.filter((article) => article.article_type === "article" && !article.is_deleted).length;
}

export function regulationPublicState(regulation: Pick<RegulationListItem,
  "is_active" | "is_repealed" | "workflow_status" | "freeze_reason"
> & { effective_date?: string | null }, now = Date.now()): string {
  if (regulation.is_repealed) return "廢止";
  if (regulation.workflow_status === "archived") return "非現行";
  if (regulation.workflow_status !== "published") return "尚未公布";
  if (regulation.effective_date && new Date(regulation.effective_date).getTime() > now) return "尚未施行";
  if (!regulation.is_active) return "非現行";
  if (regulation.freeze_reason) return "凍結中";
  // is_active 是後端明示的現行狀態，不單憑公布程序推定效力。
  return "現行";
}
