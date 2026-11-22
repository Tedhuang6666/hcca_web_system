import type {
  MerchandiseSubmissionAdminListItem,
  MerchandiseSubmissionItemCreate,
} from "@/lib/types";

export type ItemDraft = Omit<MerchandiseSubmissionItemCreate, "template_images" | "custom_fields"> & {
  id?: string;
  template_images: NonNullable<MerchandiseSubmissionItemCreate["template_images"]>;
  custom_fields: NonNullable<MerchandiseSubmissionItemCreate["custom_fields"]>;
};
export type VotingSubmission = MerchandiseSubmissionAdminListItem & {
  status: MerchandiseSubmissionAdminListItem["status"] | "review_completed";
  voting_survey_id?: string | null;
  voting_survey_title?: string | null;
  voting_survey_status?: string | null;
};
export type AdminTab = "review" | "settings" | "items";

export const reviewStatusLabels: Record<string, string> = {
  draft: "草稿",
  submitted: "已送出",
  reviewing: "審核中",
  review_completed: "審核完成",
  approved: "已採用",
  revision_requested: "需要補件",
  rejected: "未採用",
};
