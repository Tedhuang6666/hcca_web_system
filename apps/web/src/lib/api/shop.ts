import type {
  CartOut, CatalogCategoryOut, CloseStatusOut, OrderListItem, OrderOut, OrderQuantityRow, OrderSummaryOut, ProductCategoryOut, ProductOut, ProductSeriesOut, ProductVariantGroupOut, ProductVariantOptionOut, ShopClassSummaryOut, ShopOrderCloseOut,
} from "../types";
import { BASE, get, post, patch, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError } from "./core";

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

  // 購物車
  getCart: () => get<CartOut>("/shop/cart"),
  addCartItem: (body: { product_id: string; quantity: number; option_ids: string[] }) =>
    post<CartOut>("/shop/cart/items", body),
  updateCartItem: (itemId: string, quantity: number) =>
    patch<CartOut>(`/shop/cart/items/${itemId}`, { quantity }),
  removeCartItem: (itemId: string) => del<CartOut>(`/shop/cart/items/${itemId}`),
  clearCart: () => del<CartOut>("/shop/cart"),
  checkout: (notes?: string) => post<OrderOut[]>("/shop/cart/checkout", { notes }),

  // 訂單
  listOrders: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<OrderListItem[]>(`/shop/orders${qs}`);
  },
  listClassOrders: (params?: {
    is_paid?: string;
    assisted_only?: string;
    product_id?: string;
    member_user_id?: string;
    limit?: string;
    offset?: string;
  }) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<OrderListItem[]>(`/shop/orders/class${qs}`);
  },
  classSummary: (params?: {
    is_paid?: string;
    assisted_only?: string;
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
  downloadReport: (format: "xlsx" | "csv", params?: { activity_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.activity_id) q.set("activity_id", params.activity_id);
    const qs = q.toString();
    return fetch(`${BASE}/shop/reports/orders.${format}${qs ? `?${qs}` : ""}`, {
      credentials: "include",
    });
  },

  // 分類管理（shop:manage）
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
    grade?: string;
    class_id?: string;
    category_id?: string;
    product_id?: string;
    is_paid?: string;
    status?: string;
  }) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<OrderQuantityRow[]>(`/shop/orders/quantities${qs}`);
  },

  // 圖片上傳
  uploadImage: async (file: File): Promise<{ url: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/shop/images`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });
    let res = await doFetch();
    if (res.status === 401 && (await silentRefresh())) res = await doFetch();
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.json();
  },
};
