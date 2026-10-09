import type {
  ActivityOut, CatalogCategoryOut, ClassPaymentOut, CloseStatusOut, OrderListItem, OrderOut, OrderQuantityRow, OrderSummaryOut, ProductCategoryOut, ProductOut, ProductSeriesOut, ProductVariantGroupOut, ProductVariantOptionOut, ShopClassSummaryOut, ShopOrderCloseOut, ShopOrdersClearOut, ShopPromotionCreate, ShopPromotionOut, ShopPromotionPreviewOut, ShopPromotionPublicOut, ShopPromotionUpdate,
} from "../types";
import { authFetch, BASE, get, post, put, patch, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError, uploadWithProgress } from "./core";

// ── 商店 ──────────────────────────────────────────────────────────────────────

export const shopApi = {
  // 瀏覽
  catalog: (activityId?: string) => {
    const q = new URLSearchParams();
    if (activityId) q.set("activity_id", activityId);
    const qs = q.toString();
    return get<CatalogCategoryOut[]>(`/shop/catalog${qs ? `?${qs}` : ""}`);
  },
  listProducts: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<ProductOut[]>(`/shop/products${qs}`);
  },
  getProduct: (id: string) => get<ProductOut>(`/shop/products/${id}`),

  // 商品登記
  getCurrentRegistration: () => get<OrderOut | null>("/shop/registrations/current"),
  getCurrentRegistrations: () => get<OrderOut[]>("/shop/registrations"),
  setCurrentRegistrationProduct: (
    productId: string,
    body: { variants: { option_ids: string[]; quantity: number }[] },
  ) => put<OrderOut | null>(`/shop/registrations/current/products/${productId}`, body),
  previewCurrentPromotion: (code: string | null, activityId: string | null, categoryId?: string | null) =>
    post<ShopPromotionPreviewOut>("/shop/registrations/current/promotion/preview", {
      code,
      activity_id: activityId,
      category_id: categoryId,
    }),
  applyCurrentPromotion: (code: string | null, activityId: string | null, categoryId?: string | null) =>
    put<OrderOut>("/shop/registrations/current/promotion", {
      code,
      activity_id: activityId,
      category_id: categoryId,
    }),

  // 優惠管理（shop:manage）
  listPromotions: (includeInactive = true) =>
    get<ShopPromotionOut[]>(`/shop/promotions?include_inactive=${includeInactive}`),
  listAvailablePromotions: () => get<ShopPromotionPublicOut[]>("/shop/promotions/available"),
  createPromotion: (body: ShopPromotionCreate) =>
    post<ShopPromotionOut>("/shop/promotions", body),
  updatePromotion: (id: string, body: ShopPromotionUpdate) =>
    patch<ShopPromotionOut>(`/shop/promotions/${id}`, body),
  deletePromotion: (id: string) => del<void>(`/shop/promotions/${id}`),

  // 訂單
  listOrders: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<OrderListItem[]>(`/shop/orders${qs}`);
  },
  listClassOrders: (params?: {
    is_class_collected?: string;
    assisted_only?: string;
    activity_id?: string;
    category_id?: string;
    general_only?: string;
    product_id?: string;
    member_user_id?: string;
    limit?: string;
    offset?: string;
  }) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<OrderListItem[]>(`/shop/orders/class${qs}`);
  },
  classSummary: (params?: {
    is_class_collected?: string;
    assisted_only?: string;
    activity_id?: string;
    category_id?: string;
    general_only?: string;
    product_id?: string;
  }) => {
    const defined = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) : {};
    const qs = Object.keys(defined).length ? "?" + new URLSearchParams(defined).toString() : "";
    return get<ShopClassSummaryOut>(`/shop/orders/class/summary${qs}`);
  },
  orderSummary: (params: {
    group_by: "class" | "grade" | "user";
    activity_id?: string;
    product_id?: string;
    category_id?: string;
    grade?: string;
    class_id?: string;
    user_id?: string;
    status?: string;
    is_paid?: string;
    date_from?: string;
    date_to?: string;
  }) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) p.set(key, value);
    });
    return get<OrderSummaryOut>(`/shop/orders/summary?${p.toString()}`);
  },
  getOrder: (id: string) => get<OrderOut>(`/shop/orders/${id}`),
  clearAllOrders: () => del<ShopOrdersClearOut>("/shop/orders"),
  createClassOrder: (body: {
    user_id: string;
    items: { product_id: string; quantity: number; option_ids: string[] }[];
    notes?: string | null;
  }) => post<OrderOut[]>("/shop/orders/class", body),
  updateOrder: (id: string, body: {
    user_id: string;
    items: { product_id: string; quantity: number; option_ids: string[] }[];
    notes?: string | null;
  }) => patch<OrderOut>(`/shop/orders/${id}`, body),
  cancelOrder: (id: string, reason?: string) =>
    post<OrderOut>(`/shop/orders/${id}/cancel`, { reason }),
  setOrderPaid: (id: string, isPaid: boolean) =>
    patch<OrderOut>(`/shop/orders/${id}/payment`, { is_paid: isPaid }),
  setClassCollected: (id: string, collected: boolean) =>
    patch<OrderOut>(`/shop/orders/${id}/collection`, { is_class_collected: collected }),
  setClassPaid: (classId: string, isPaid: boolean, activityId: string | null) =>
    patch<ClassPaymentOut>(
      `/shop/orders/classes/${classId}/payment`, {
        is_paid: isPaid,
        activity_id: activityId,
      },
    ),
  downloadReport: (format: "xlsx" | "csv", params?: { activity_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.activity_id) q.set("activity_id", params.activity_id);
    const qs = q.toString();
    return authFetch(`${BASE}/shop/reports/orders.${format}${qs ? `?${qs}` : ""}`, {
      credentials: "include",
    });
  },

  // 分類管理（shop:manage）
  listActivities: () => get<ActivityOut[]>("/shop/activities"),
  listCategories: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<ProductCategoryOut[]>(`/shop/categories${qs}`);
  },
  createCategory: (body: Record<string, unknown>) =>
    post<ProductCategoryOut>("/shop/categories", body),
  updateCategory: (id: string, body: Record<string, unknown>) =>
    patch<ProductCategoryOut>(`/shop/categories/${id}`, body),
  deleteCategory: (id: string) => del<void>(`/shop/categories/${id}`),
  listSeries: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<ProductSeriesOut[]>(`/shop/series${qs}`);
  },
  createSeries: (body: Record<string, unknown>) =>
    post<ProductSeriesOut>("/shop/series", body),
  updateSeries: (id: string, body: Record<string, unknown>) =>
    patch<ProductSeriesOut>(`/shop/series/${id}`, body),
  deleteSeries: (id: string) => del<void>(`/shop/series/${id}`),

  // 商品管理
  createProduct: (body: Record<string, unknown>) => post<ProductOut>("/shop/products", body),
  updateProduct: (id: string, body: Record<string, unknown>) =>
    patch<ProductOut>(`/shop/products/${id}`, body),
  activateProduct: (id: string) => post<ProductOut>(`/shop/products/${id}/activate`, {}),
  deactivateProduct: (id: string) => post<ProductOut>(`/shop/products/${id}/deactivate`, {}),
  deleteProduct: (id: string) => del<void>(`/shop/products/${id}`),

  // 變體管理
  addVariantGroup: (productId: string, body: Record<string, unknown>) =>
    post<ProductVariantGroupOut>(`/shop/products/${productId}/variant-groups`, body),
  updateVariantGroup: (groupId: string, body: Record<string, unknown>) =>
    patch<ProductVariantGroupOut>(`/shop/variant-groups/${groupId}`, body),
  deleteVariantGroup: (groupId: string) => del<void>(`/shop/variant-groups/${groupId}`),
  addVariantOption: (groupId: string, body: Record<string, unknown>) =>
    post<ProductVariantOptionOut>(`/shop/variant-groups/${groupId}/options`, body),
  updateVariantOption: (optionId: string, body: Record<string, unknown>) =>
    patch<ProductVariantOptionOut>(`/shop/variant-options/${optionId}`, body),
  deleteVariantOption: (optionId: string) => del<void>(`/shop/variant-options/${optionId}`),

  // 結單管理
  closeCategory: (categoryId: string, body: { class_id?: string; notes?: string }) =>
    post<ShopOrderCloseOut>(`/shop/categories/${categoryId}/close`, body),
  reopenCategory: (categoryId: string, classId?: string) => {
    const qs = classId ? `?class_id=${classId}` : "";
    return del<ShopOrderCloseOut>(`/shop/categories/${categoryId}/close${qs}`);
  },
  getCloseStatus: (categoryIds: string[], classId?: string) => {
    const p = new URLSearchParams();
    categoryIds.forEach((id) => p.append("category_ids", id));
    if (classId) p.set("class_id", classId);
    return get<CloseStatusOut>(`/shop/close-status?${p.toString()}`);
  },

  // 班聯數量彙總
  orderQuantities: (params?: {
    activity_id?: string;
    grade?: string;
    class_id?: string;
    category_id?: string;
    product_id?: string;
    is_paid?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
  }) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<OrderQuantityRow[]>(`/shop/orders/quantities${qs}`);
  },

  // 圖片上傳
  uploadImage: async (file: File, onProgress?: (progress: number) => void): Promise<{ url: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      uploadWithProgress(`${BASE}/shop/images`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      }, onProgress);
    let res = await doFetch();
    if (res.status === 401 && (await silentRefresh())) res = await doFetch();
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.json();
  },
};
