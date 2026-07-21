import type {
  RecommendedVendorCreate,
  RecommendedVendorListItem,
  RecommendedVendorOut,
  RecommendedVendorProductCreate,
  RecommendedVendorProductOut,
  RecommendedVendorProductUpdate,
  RecommendedVendorUpdate,
} from "../types";
import { del, get, patch, post } from "./core";

export const recommendedVendorsApi = {
  list: (params?: { keyword?: string; category?: string; map_only?: boolean }) => {
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
};
