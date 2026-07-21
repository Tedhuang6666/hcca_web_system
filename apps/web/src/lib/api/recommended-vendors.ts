import type {
  RecommendedVendorCategoryOut,
  RecommendedVendorCreate,
  RecommendedVendorListItem,
  RecommendedVendorMenuOut,
  RecommendedVendorOut,
  RecommendedVendorProductCreate,
  RecommendedVendorProductOut,
  RecommendedVendorProductUpdate,
  RecommendedVendorUpdate,
} from "../types";
import { del, get, patch, post, BASE, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError } from "./core";

export const recommendedVendorsApi = {
  listCategories: () => get<RecommendedVendorCategoryOut[]>("/recommended-vendors/categories"),
  list: (params?: { keyword?: string; category_id?: string; map_only?: boolean }) => {
    const query = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return get<RecommendedVendorListItem[]>(
      `/recommended-vendors${query.size ? `?${query.toString()}` : ""}`,
    );
  },
  get: (id: string) => get<RecommendedVendorOut>(`/recommended-vendors/${id}`),
  adminList: (params?: { keyword?: string; include_inactive?: boolean }) => {
    const query = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return get<RecommendedVendorListItem[]>(
      `/recommended-vendors/admin/vendors${query.size ? `?${query.toString()}` : ""}`,
    );
  },
  adminGet: (id: string) => get<RecommendedVendorOut>(`/recommended-vendors/admin/vendors/${id}`),
  create: (body: RecommendedVendorCreate) =>
    post<RecommendedVendorOut>("/recommended-vendors/admin/vendors", body),
  update: (id: string, body: RecommendedVendorUpdate) =>
    patch<RecommendedVendorOut>(`/recommended-vendors/admin/vendors/${id}`, body),
  archive: (id: string) => del<void>(`/recommended-vendors/admin/vendors/${id}`),
  createProduct: (vendorId: string, body: RecommendedVendorProductCreate) =>
    post<RecommendedVendorProductOut>(`/recommended-vendors/admin/vendors/${vendorId}/products`, body),
  updateProduct: (id: string, body: RecommendedVendorProductUpdate) =>
    patch<RecommendedVendorProductOut>(`/recommended-vendors/admin/products/${id}`, body),
  deleteProduct: (id: string) => del<void>(`/recommended-vendors/admin/products/${id}`),
  listCategoriesAdmin: () => get<RecommendedVendorCategoryOut[]>("/recommended-vendors/admin/categories"),
  createCategory: (body: { name: string; description?: string | null; sort_order?: number; is_active?: boolean }) =>
    post<RecommendedVendorCategoryOut>("/recommended-vendors/admin/categories", body),
  updateCategory: (id: string, body: { name?: string; description?: string | null; sort_order?: number; is_active?: boolean }) =>
    patch<RecommendedVendorCategoryOut>(`/recommended-vendors/admin/categories/${id}`, body),
  createMenu: (vendorId: string, body: { title: string; url: string; sort_order?: number; is_active?: boolean }) =>
    post<RecommendedVendorMenuOut>(`/recommended-vendors/admin/vendors/${vendorId}/menus`, { ...body, kind: "link" }),
  updateMenu: (id: string, body: { title?: string; sort_order?: number; is_active?: boolean }) =>
    patch<RecommendedVendorMenuOut>(`/recommended-vendors/admin/menus/${id}`, body),
  deleteMenu: (id: string) => del<void>(`/recommended-vendors/admin/menus/${id}`),
  uploadMenu: async (vendorId: string, file: File, title?: string): Promise<RecommendedVendorMenuOut> => {
    const form = new FormData();
    form.append("file", file);
    if (title?.trim()) form.append("title", title.trim());
    const request = () => fetch(`${BASE}/recommended-vendors/admin/vendors/${vendorId}/menus/upload`, {
      method: "POST",
      credentials: "include",
      headers: csrfHeaders("POST"),
      body: form,
    });
    let response = await request();
    if (response.status === 401 && (await silentRefresh())) response = await request();
    if (!response.ok) throw new ApiError(response.status, await errorMessageFromResponse(response));
    return response.json();
  },
};
