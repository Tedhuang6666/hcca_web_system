import type { AgencyBranch, AgencyEntryCreate } from "./types";

export type AgencyEntryKind = AgencyEntryCreate["kind"];
export type AgencyEntryStatus = NonNullable<AgencyEntryCreate["status"]>;

export const BRANCH_META: Record<AgencyBranch, { label: string; role: string }> = {
  executive: { label: "行政", role: "學生會" },
  legislative: { label: "立法", role: "學生議會" },
  judicial: { label: "司法", role: "評議委員會" },
  delegation: { label: "校務參與", role: "學生代表團" },
};

export const BRANCH_ORDER: AgencyBranch[] = ["executive", "legislative", "judicial", "delegation"];

export const KIND_META: Record<AgencyEntryKind, { label: string }> = {
  document: { label: "文件公開" },
  event: { label: "重要日程" },
  policy: { label: "政策執行" },
  achievement: { label: "活動成果" },
  session: { label: "會議紀錄" },
  bill: { label: "法案審議" },
  committee: { label: "委員會" },
  finance: { label: "財政監督" },
  procedure: { label: "聲請程序" },
  template: { label: "申請範本" },
  decision: { label: "評議書" },
  meeting: { label: "校務會議" },
  proposal: { label: "提案成果" },
  rights: { label: "學生權益" },
};

/** 與後端 BRANCH_ENTRY_KINDS 對應，依專頁呈現順序排列。 */
export const BRANCH_KINDS: Record<AgencyBranch, AgencyEntryKind[]> = {
  executive: ["policy", "achievement", "event", "document"],
  legislative: ["session", "bill", "committee", "finance", "event", "document"],
  judicial: ["procedure", "template", "decision", "event", "document"],
  delegation: ["proposal", "meeting", "rights", "event", "document"],
};

export const STATUS_LABEL: Record<AgencyEntryStatus, string> = {
  planned: "規劃中",
  in_progress: "執行中",
  completed: "已完成",
  under_review: "審議中",
  passed: "通過",
  rejected: "未通過",
  withdrawn: "撤回",
  decided: "已評議",
  dismissed: "不受理",
  adopted: "校方採納",
  tracking: "持續追蹤",
};

export const KIND_STATUSES: Partial<Record<AgencyEntryKind, AgencyEntryStatus[]>> = {
  policy: ["planned", "in_progress", "completed", "tracking"],
  achievement: ["completed"],
  bill: ["under_review", "passed", "rejected", "withdrawn"],
  finance: ["under_review", "passed", "rejected", "tracking"],
  decision: ["decided", "dismissed"],
  proposal: ["planned", "under_review", "adopted", "rejected", "tracking"],
};

/** 代表團提案流程：學生意見如何進入校方決策。 */
export const DELEGATION_STAGES: { label: string; statuses: AgencyEntryStatus[] }[] = [
  { label: "彙整學生意見", statuses: ["planned"] },
  { label: "提案至校務會議", statuses: ["under_review"] },
  { label: "校方回應", statuses: ["adopted", "rejected"] },
  { label: "持續追蹤", statuses: ["tracking"] },
];

export const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  committee_review: "常委會審查",
  scheduled: "已排入議程",
  council_review: "大會審議",
  passed: "三讀通過",
  rejected: "未通過",
  published: "公布施行",
};

export const PROPOSAL_STEPS = ["committee_review", "scheduled", "council_review", "passed", "published"];

export const CASE_TYPE_LABEL: Record<string, string> = {
  regulation: "法規案",
  finance: "財政案",
  recall: "罷免案",
  impeachment: "彈劾案",
  personnel: "人事案",
  resolution: "決議案",
  constitutional_norm_review: "法規範審查",
  org_dispute: "機關爭議",
  election_dispute: "選舉爭議",
  disciplinary_appeal: "懲戒救濟",
  other: "其他",
};

export function formatTwDate(value: string | null | undefined): string {
  if (!value) return "";
  // date-only 字串以台北日曆日解讀，避免 UTC 位移成前一天。
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+08:00`) : new Date(value);
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

/** 內容欄位在各類型的標題；未列出者不顯示小標。 */
export const BODY_LABEL: Partial<Record<AgencyEntryKind, string>> = {
  decision: "主文",
  bill: "法案內容",
  proposal: "提案內容",
};

export const OUTCOME_LABEL: Partial<Record<AgencyEntryKind, string>> = {
  policy: "執行情形",
  achievement: "成果",
  session: "決議事項",
  bill: "審議結果",
  finance: "審查結果",
  decision: "理由",
  meeting: "會議決議",
  proposal: "校方回應",
};
