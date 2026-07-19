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

async function upload(path: string, file: File, query = ""): Promise<MerchandiseSubmissionUploadOut> {
  const body = new FormData();
  body.append("file", file);
  const request = () => fetch(`${BASE}${path}${query}`, {
    method: "POST",
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
    upload("/merchandise-submissions/uploads", file, `?item_id=${encodeURIComponent(itemId)}`),
  save: (body: {
    item_id: string;
    field_values: Record<string, string>;
    files: MerchandiseSubmissionUploadOut[];
  }, submit = true) => post<MerchandiseSubmissionOut>(`/merchandise-submissions/submissions?submit=${submit}`, body),
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
  review: (id: string, body: MerchandiseSubmissionReview) =>
    patch<MerchandiseSubmissionAdminListItem>(`/merchandise-submissions/admin/submissions/${id}/review`, body),
  uploadTemplateImage: (file: File) =>
    upload("/merchandise-submissions/admin/template-images", file),
};
