import type {
  AdminAssistedOrderCreate,
  ChangedOrderReceiptCreate,
  ClassReceiptBatchCreate,
  ClassMemberOut,
  ShopSalesAnalyticsOut,
  ShopSalesReportCreate,
  ClassOrderCreate, ShopDelegatedOrderOut, ShopDelegationCodeOut, ShopDelegationContextOut, ShopDelegationCreate, ShopDelegationOut,
  ActivityOut, CatalogCategoryOut, ClassPaymentOut, ClassPaymentReportItemOut, CloseStatusOut, OrderListItem, OrderOut, OrderQuantityRow, OrderSummaryOut, ProductCategoryOut, ProductOut, ProductSeriesOut, ProductVariantGroupOut, ProductVariantOptionOut, ShopClassSummaryOut, ShopOrderCloseOut, ShopOrdersClearOut, ShopPromotionCreate, ShopPromotionOut, ShopPromotionPreviewOut, ShopPromotionPublicOut, ShopPromotionUpdate,
} from "../types";
import { authFetch, BASE, get, post, put, patch, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError, uploadWithProgress } from "./core";

// ── 商店 ──────────────────────────────────────────────────────────────────────

export const shopApi = {
  salesAnalytics: (params: Record<string, string>) =>
    get<ShopSalesAnalyticsOut>(`/shop/orders/analytics?${new URLSearchParams(params)}`),
  downloadSalesReport: async (body: ShopSalesReportCreate) => {
    const response = await authFetch(`${BASE}/shop/orders/analytics/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders("POST") },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new ApiError(response.status, await errorMessageFromResponse(response));
    return response;
  },
  updateActivityDeadline: (id: string, orderClosesAt: string | null) =>
    patch<ActivityOut>(`/shop/activities/${id}/order-deadline`, { order_closes_at: orderClosesAt }),
  updateActivityOrderClosure: (id: string, isClosed: boolean) =>
    patch<ActivityOut>(`/shop/activities/${id}/order-closure`, { is_closed: isClosed }),
  listDelegationLinks: () => get<ShopDelegationOut[]>("/shop/delegation-links"),
  createDelegationLink: (body: ShopDelegationCreate) => post<ShopDelegationOut>("/shop/delegation-links", body),
  renameDelegationLink: (id: string, name: string) => patch<ShopDelegationOut>(`/shop/delegation-links/${id}`, { name }),
  revokeDelegationLink: (id: string) => del<void>(`/shop/delegation-links/${id}`),
  renewDelegationLink: (id: string) => post<ShopDelegationOut>(`/shop/delegation-links/${id}/renew`),
  accessDelegation: (token: string, claim = false) => post<ShopDelegationContextOut>("/shop/delegation/access", { token, claim }),
  exchangeDelegationCode: (code: string) => post<ShopDelegationCodeOut>("/shop/delegation/code", { code }),
  getDelegationProduct: (token: string, id: string) => post<ProductOut>(`/shop/delegation/products/${id}/read`, { token }),
  setDelegationProduct: (token: string, id: string, body: { variants: { option_ids: string[]; quantity: number }[] }) =>
    post<OrderOut | null>(`/shop/delegation/products/${id}`, { token, ...body }),
  previewDelegationPromotion: (token: string, code: string | null) =>
    post<ShopPromotionPreviewOut>("/shop/delegation/promotion/preview", { token, code }),
  applyDelegationPromotion: (token: string, code: string | null) =>
    post<OrderOut>("/shop/delegation/promotion", { token, code }),
  updateOrderItemQuantity: (orderId: string, itemId: string, quantity: number) =>
    patch<OrderOut | null>(`/shop/orders/${orderId}/items/${itemId}`, { quantity }),
  // 瀏覽
  catalog: (activityId?: string, includeClosed = false, directPath?: string[]) => {
    const q = new URLSearchParams();
    if (activityId) q.set("activity_id", activityId);
    if (includeClosed) q.set("include_closed", "true");
    directPath?.forEach((segment) => q.append("direct_path", segment));
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
  listDelegatedOrders: (params?: { order_id?: string; limit?: string; offset?: string }) => {
    const defined = params
      ? Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined))
      : {};
    const qs = Object.keys(defined).length ? `?${new URLSearchParams(defined).toString()}` : "";
    return get<ShopDelegatedOrderOut[]>(`/shop/orders/delegated${qs}`);
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
  listClassMemberRegistrations: (memberUserId: string) =>
    get<OrderOut[]>(`/shop/orders/class/members/${memberUserId}/registrations`),
  setClassMemberProduct: (
    memberUserId: string,
    productId: string,
    body: { variants: { option_ids: string[]; quantity: number }[] },
  ) => put<OrderOut[]>(`/shop/orders/class/members/${memberUserId}/products/${productId}`, body),
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
  createClassOrder: (body: ClassOrderCreate) => post<OrderOut[]>("/shop/orders/class", body),
  listOrderRecipients: (classId: string) => get<ClassMemberOut[]>(`/shop/orders/recipients/${classId}`),
  createAdminAssistedOrder: (body: AdminAssistedOrderCreate) => post<OrderOut[]>("/shop/orders/assisted", body),
  listSupplementOrders: (offset = 0) => get<OrderListItem[]>(`/shop/orders/supplements?limit=500&offset=${offset}`),
  separateOrder: (id: string) => post<OrderOut>(`/shop/orders/${id}/separate`),
  rejoinSupplementOrder: (id: string) => post<OrderOut>(`/shop/orders/${id}/rejoin-class`),
  downloadSupplementReceipt: async (id: string) => {
    const response = await authFetch(`${BASE}/shop/orders/${id}/supplement-receipt.pdf`, { credentials: "include" });
    if (!response.ok) throw new ApiError(response.status, await errorMessageFromResponse(response));
    return response;
  },
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
  classPaymentReport: () => get<ClassPaymentReportItemOut[]>("/shop/orders/class-payments"),
  downloadClassReceipt: async (classId: string, activityId: string | null) => {
    const query = activityId ? `?${new URLSearchParams({ activity_id: activityId })}` : "";
    const response = await authFetch(`${BASE}/shop/orders/classes/${classId}/receipt.pdf${query}`, {
      credentials: "include",
    });
    if (!response.ok) throw new ApiError(response.status, await errorMessageFromResponse(response));
    return response;
  },
  downloadClassReceipts: async (activityId: string | null, classIds?: string[], unpaidOnly = false) => {
    const response = await authFetch(`${BASE}/shop/orders/classes/receipts.pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders("POST") },
      body: JSON.stringify({ activity_id: activityId, class_ids: classIds ?? null, unpaid_only: unpaidOnly } satisfies ClassReceiptBatchCreate),
      credentials: "include",
    });
    if (!response.ok) throw new ApiError(response.status, await errorMessageFromResponse(response));
    return response;
  },
  downloadChangedOrderReceipts: async (activityId: string | null) => {
    const response = await authFetch(`${BASE}/shop/orders/receipts/changed.pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders("POST") },
      body: JSON.stringify({ activity_id: activityId } satisfies ChangedOrderReceiptCreate),
      credentials: "include",
    });
    if (!response.ok) throw new ApiError(response.status, await errorMessageFromResponse(response));
    return response;
  },
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
  testProduct: (id: string) => post<ProductOut>(`/shop/products/${id}/test`, {}),
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
  getClassDeadline: (categoryId: string, classId: string) => get<ShopOrderCloseOut | null>(`/shop/categories/${categoryId}/class-deadline?class_id=${classId}`),
  closeCategory: (categoryId: string, body: { notes?: string; class_id?: string; closes_at?: string | null }) =>
    post<ShopOrderCloseOut>(`/shop/categories/${categoryId}/close`, body),
  reopenCategory: (categoryId: string, classId?: string) =>
    del<ShopOrderCloseOut>(`/shop/categories/${categoryId}/close${classId ? `?class_id=${classId}` : ""}`),
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
    const query = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const qs = query.toString();
    return get<OrderQuantityRow[]>(`/shop/orders/quantities${qs ? `?${qs}` : ""}`);
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
