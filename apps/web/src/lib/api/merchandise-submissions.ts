import type {
  MerchandiseSubmissionAdminListItem,
  MerchandiseSubmissionItemCreate,
  MerchandiseSubmissionItemOut,
  MerchandiseSubmissionOut,
  MerchandiseSubmissionPortalOut,
  MerchandiseSubmissionReview,
  MerchandiseSubmissionSettingsOut,
  MerchandiseSubmissionSettingsUpdate,
  MerchandiseSubmissionUploadOut,
} from "../types";
import { BASE, ApiError, csrfHeaders, errorMessageFromResponse, get, patch, post, silentRefresh } from "./core";

type MerchandiseSubmissionReviewBody = Omit<MerchandiseSubmissionReview, "status"> & {
  status: MerchandiseSubmissionReview["status"] | "review_completed";
  voting_survey_id?: string | null;
};

async function upload<T>(path: string, file: File, query = "", method = "POST"): Promise<T> {
  const body = new FormData();
  body.append("file", file);
  const request = () => fetch(`${BASE}${path}${query}`, {
    method,
    credentials: "include",
    headers: csrfHeaders("POST"),
    body,
  });
  let response = await request();
  if (response.status === 401 && await silentRefresh()) response = await request();
  if (!response.ok) throw new ApiError(response.status, await errorMessageFromResponse(response));
  return response.json();
}

export const merchandiseSubmissionsApi = {
  portal: () => get<MerchandiseSubmissionPortalOut>("/merchandise-submissions/portal"),
  mine: () => get<MerchandiseSubmissionOut[]>("/merchandise-submissions/submissions/me"),
  upload: (itemId: string, file: File) =>
    upload<MerchandiseSubmissionUploadOut>(
      "/merchandise-submissions/uploads",
      file,
      `?item_id=${encodeURIComponent(itemId)}`,
    ),
  save: (body: {
    item_id: string;
    field_values: Record<string, string>;
    files: MerchandiseSubmissionUploadOut[];
  }, submit = true) => post<MerchandiseSubmissionOut>(`/merchandise-submissions/submissions?submit=${submit}`, body),
  updateSubmission: (id: string, body: {
    item_id: string;
    field_values: Record<string, string>;
    files: MerchandiseSubmissionUploadOut[];
  }, submit = true) => patch<MerchandiseSubmissionOut>(`/merchandise-submissions/submissions/${id}?submit=${submit}`, body),
  getSettings: () => get<MerchandiseSubmissionSettingsOut>("/merchandise-submissions/admin/settings"),
  updateSettings: (body: MerchandiseSubmissionSettingsUpdate) =>
    patch<MerchandiseSubmissionSettingsOut>("/merchandise-submissions/admin/settings", body),
  listItems: () => get<MerchandiseSubmissionItemOut[]>("/merchandise-submissions/admin/items"),
  createItem: (body: MerchandiseSubmissionItemCreate) =>
    post<MerchandiseSubmissionItemOut>("/merchandise-submissions/admin/items", body),
  updateItem: (id: string, body: Partial<MerchandiseSubmissionItemCreate>) =>
    patch<MerchandiseSubmissionItemOut>(`/merchandise-submissions/admin/items/${id}`, body),
  listSubmissions: (status?: string) =>
    get<MerchandiseSubmissionAdminListItem[]>(
      `/merchandise-submissions/admin/submissions${status ? `?status=${status}` : ""}`,
    ),
  review: (id: string, body: MerchandiseSubmissionReviewBody) =>
    patch<MerchandiseSubmissionAdminListItem>(`/merchandise-submissions/admin/submissions/${id}/review`, body),
  prepareVotingSurvey: (body: { org_id: string; title?: string; description?: string | null }) =>
    post<import("../types").SurveyOut>("/merchandise-submissions/admin/voting-survey/prepare", body),
  uploadTemplateImage: (file: File) =>
    upload<MerchandiseSubmissionUploadOut>("/merchandise-submissions/admin/template-images", file),
  addSubmissionFile: (submissionId: string, file: File) =>
    upload<MerchandiseSubmissionAdminListItem>(
      `/merchandise-submissions/admin/submissions/${submissionId}/files`,
      file,
    ),
  replaceSubmissionFile: (submissionId: string, fileId: string, file: File) =>
    upload<MerchandiseSubmissionAdminListItem>(
      `/merchandise-submissions/admin/submissions/${submissionId}/files/${fileId}`,
      file,
      "",
      "PUT",
    ),
};
