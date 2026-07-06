import type {
  ItemStatOut, MealAvailabilityOut, MealClassPickupCodeOut, MealOrderListItem, MealOrderOut, MealPickupLookupOut, MealProductOut, MealVendorApplicationOut, MealVendorOut, MenuItemOut, MenuScheduleListItem, MenuScheduleOut, PickupListItemOut, VendorManagerOut,
} from "../types";
import { BASE, get, post, patch, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError } from "./core";

// ── 學餐系統 ──────────────────────────────────────────────────────────────────

export const mealApi = {
  // 商家
  listVendors: (params?: { org_id?: string; active_only?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
    return get<MealVendorOut[]>(`/meal/vendors?${q}`);
  },

  // 菜單排程
  listSchedules: (params?: { vendor_id?: string; is_closed?: boolean; date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.is_closed !== undefined) q.set("is_closed", String(params.is_closed));
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    return get<MenuScheduleListItem[]>(`/meal/schedules?${q}`);
  },
  getSchedule: (id: string) => get<MenuScheduleOut>(`/meal/schedules/${id}`),
  createSchedule: (body: {
    vendor_id: string; date: string;
    order_open_time?: string | null; order_deadline: string; note?: string;
  }) => post<MenuScheduleOut>("/meal/schedules", body),
  updateSchedule: (id: string, body: {
    order_open_time?: string | null; order_deadline?: string; note?: string | null;
  }) => patch<MenuScheduleOut>(`/meal/schedules/${id}`, body),
  closeSchedule: (id: string) => post<MenuScheduleOut>(`/meal/schedules/${id}/close`),
  addMenuItem: (scheduleId: string, body: {
    name: string; description?: string; price: number; max_quantity?: number | null;
  }) => post<MenuItemOut>(`/meal/schedules/${scheduleId}/items`, body),
  updateMenuItem: (itemId: string, body: {
    name?: string; description?: string | null; price?: number;
    max_quantity?: number | null; is_available?: boolean;
  }) => patch<MenuItemOut>(`/meal/items/${itemId}`, body),
  deleteMenuItem: (itemId: string) => del<void>(`/meal/items/${itemId}`),

  // 商家管理
  createVendor: (body: {
    name: string; org_id?: string | null; description?: string | null;
    contact_phone?: string | null; contact_email?: string | null; manager_email?: string | null;
    status?: string | null;
  }) =>
    post<MealVendorOut>("/meal/vendors", body),
  updateVendor: (id: string, body: {
    name?: string; description?: string | null;
    contact_phone?: string | null; contact_email?: string | null; is_active?: boolean;
    status?: string; review_note?: string | null;
  }) => patch<MealVendorOut>(`/meal/vendors/${id}`, body),
  createVendorApplication: (body: {
    name: string; org_id?: string | null; description?: string | null;
    contact_name?: string | null; contact_phone?: string | null; contact_email?: string | null;
  }) => post<MealVendorApplicationOut>("/meal/vendor-applications", body),
  listVendorApplications: (params?: { status?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    return get<MealVendorApplicationOut[]>(`/meal/vendor-applications?${q}`);
  },
  reviewVendorApplication: (id: string, body: { approved: boolean; review_note?: string | null }) =>
    post<MealVendorApplicationOut>(`/meal/vendor-applications/${id}/review`, body),
  listVendorManagers: (vendorId: string) =>
    get<VendorManagerOut[]>(`/meal/vendors/${vendorId}/managers`),
  removeVendorManager: (vendorId: string, userId: string) =>
    del<void>(`/meal/vendors/${vendorId}/managers/${userId}`),
  uploadImage: async (file: File): Promise<{ url: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/meal/images`, {
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
  listProducts: (params?: { vendor_id?: string; active_only?: boolean; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    return get<MealProductOut[]>(`/meal/products?${q}`);
  },
  createProduct: (body: {
    vendor_id: string; name: string; description?: string | null; category?: string | null;
    image_url?: string | null; price: number; default_max_quantity?: number | null;
  }) => post<MealProductOut>("/meal/products", body),
  updateProduct: (id: string, body: Partial<{
    name: string; description: string | null; category: string | null; image_url: string | null;
    price: number; default_max_quantity: number | null; is_active: boolean;
  }>) => patch<MealProductOut>(`/meal/products/${id}`, body),
  listAvailabilities: (params?: {
    vendor_id?: string; date_from?: string; date_to?: string; active_only?: boolean; limit?: number; offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    return get<MealAvailabilityOut[]>(`/meal/availabilities?${q}`);
  },
  createAvailability: (body: {
    product_id: string; service_date: string; sale_start?: string | null; sale_end?: string | null;
    price?: number | null; max_quantity?: number | null; note?: string | null;
    pickup_slots?: {
      label: string; sort_order?: number; pickup_start: string; pickup_end: string;
      order_deadline: string; capacity?: number | null;
    }[];
  }) => post<MealAvailabilityOut>("/meal/availabilities", body),
  bulkCreateWeeklyAvailabilities: (body: {
    product_ids: string[]; date_from: string; date_to: string; weekdays: number[];
    sale_start_time?: string | null; sale_end_time?: string | null;
    pickup_slots?: {
      label: string; sort_order?: number; pickup_start: string; pickup_end: string;
      order_deadline: string; capacity?: number | null;
    }[];
  }) => post<MealAvailabilityOut[]>("/meal/availabilities/weekly", body),

  // 訂單
  createOrder: (body: {
    schedule_id?: string | null; pickup_slot_id?: string | null;
    items: { menu_item_id?: string | null; availability_id?: string | null; quantity: number }[];
    notes?: string;
  }) =>
    post<MealOrderOut>("/meal/orders", body),
  listOrders: (params?: { my_only?: boolean; schedule_id?: string; vendor_id?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.my_only !== undefined) q.set("my_only", String(params.my_only));
    if (params?.schedule_id) q.set("schedule_id", params.schedule_id);
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    return get<MealOrderListItem[]>(`/meal/orders?${q}`);
  },
  getOrder: (id: string) => get<MealOrderOut>(`/meal/orders/${id}`),
  createClassOrder: (body: {
    user_id: string;
    order: {
      schedule_id?: string | null; pickup_slot_id?: string | null;
      items: { menu_item_id?: string | null; availability_id?: string | null; quantity: number }[];
      notes?: string | null;
    };
  }) => post<MealOrderOut>("/meal/orders/class", body),
  updateOrder: (id: string, body: {
    schedule_id?: string | null; pickup_slot_id?: string | null;
    items: { menu_item_id?: string | null; availability_id?: string | null; quantity: number }[];
    notes?: string | null;
  }) => patch<MealOrderOut>(`/meal/orders/${id}`, body),
  cancelOrder: (id: string, reason?: string) =>
    post<MealOrderOut>(`/meal/orders/${id}/cancel`, { reason }),
  confirmOrder: (id: string) => post<MealOrderOut>(`/meal/orders/${id}/confirm`),
  completeOrder: (id: string) => post<MealOrderOut>(`/meal/orders/${id}/complete`),
  setOrderPaid: (id: string, isPaid: boolean) =>
    post<MealOrderOut>(`/meal/orders/${id}/payment?is_paid=${String(isPaid)}`),
  listClassOrders: (params?: { vendor_id?: string; pickup_slot_id?: string; is_paid?: boolean; assisted_only?: boolean; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.pickup_slot_id) q.set("pickup_slot_id", params.pickup_slot_id);
    if (params?.is_paid !== undefined) q.set("is_paid", String(params.is_paid));
    if (params?.assisted_only !== undefined) q.set("assisted_only", String(params.assisted_only));
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    return get<MealOrderListItem[]>(`/meal/orders/class?${q}`);
  },
  getClassPickupCode: (params: { class_id: string; vendor_id: string; pickup_slot_id: string }) => {
    const q = new URLSearchParams(params);
    return post<MealClassPickupCodeOut>(`/meal/orders/class-pickup-code?${q}`);
  },
  lookupByCode: (code: string) => get<MealOrderOut>(`/meal/orders/lookup?code=${encodeURIComponent(code)}`),
  pickupLookup: (code: string, redeem = true) =>
    post<MealPickupLookupOut>(`/meal/pickup/lookup?code=${encodeURIComponent(code)}&redeem=${String(redeem)}`),
  getScheduleItemStats: (scheduleId: string) => get<ItemStatOut[]>(`/meal/schedules/${scheduleId}/item-stats`),
  getPickupList: (scheduleId: string) => get<PickupListItemOut[]>(`/meal/schedules/${scheduleId}/pickup-list`),
  assignVendorManager: (vendorId: string, email: string) =>
    post<VendorManagerOut>(`/meal/vendors/${vendorId}/managers`, { email }),
  downloadReport: (format: "xlsx" | "csv", params?: { vendor_id?: string; schedule_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.schedule_id) q.set("schedule_id", params.schedule_id);
    const qs = q.toString() ? `?${q}` : "";
    return fetch(`${BASE}/meal/reports/orders.${format}${qs}`, {
      credentials: "include",
    });
  },
};
