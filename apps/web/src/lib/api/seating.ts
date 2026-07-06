import type {
  HoldOut, SeatBookingOut, SeatInput, SeatMapOut, WaveInput, ZoneListItem, ZoneOut,
} from "../types";
import { get, post, patch, del, request } from "./core";

// ── 劃位 / 票券 ────────────────────────────────────────────────────────────────

export const seatingApi = {
  // 管理：場次與座位圖
  listZones: (productId: string) => get<ZoneListItem[]>(`/seating/products/${productId}/zones`),
  getZone: (zoneId: string) => get<ZoneOut>(`/seating/zones/${zoneId}`),
  createZone: (body: {
    product_id: string; name: string; description?: string | null;
    starts_at?: string | null; seating_opens_at?: string | null;
    hold_minutes?: number; layout?: Record<string, unknown>; sort_order?: number;
  }) => post<ZoneOut>("/seating/zones", body),
  updateZone: (zoneId: string, body: Record<string, unknown>) =>
    patch<ZoneOut>(`/seating/zones/${zoneId}`, body),
  deleteZone: (zoneId: string) => del<void>(`/seating/zones/${zoneId}`),
  saveSeats: (zoneId: string, body: { layout?: Record<string, unknown>; seats: SeatInput[] }) =>
    request<ZoneOut>(`/seating/zones/${zoneId}/seats`, { method: "PUT", body: JSON.stringify(body) }),
  saveWaves: (zoneId: string, body: { waves: WaveInput[] }) =>
    request<ZoneOut>(`/seating/zones/${zoneId}/waves`, { method: "PUT", body: JSON.stringify(body) }),
  zoneAssignments: (zoneId: string) => get<SeatBookingOut[]>(`/seating/zones/${zoneId}/assignments`),
  releaseAssignment: (assignmentId: string) => del<void>(`/seating/assignments/${assignmentId}`),
  adminAssign: (body: { order_id: string; seat_ids: string[] }) =>
    post<SeatBookingOut[]>("/seating/assign", body),

  // 使用者自助選位
  seatMap: (zoneId: string, orderId?: string) =>
    get<SeatMapOut>(`/seating/zones/${zoneId}/map${orderId ? `?order_id=${orderId}` : ""}`),
  hold: (zoneId: string, seatIds: string[]) =>
    post<HoldOut>(`/seating/zones/${zoneId}/hold`, { seat_ids: seatIds }),
  releaseHold: (zoneId: string) => del<void>(`/seating/zones/${zoneId}/hold`),
  select: (body: { order_id: string; seat_ids: string[] }) =>
    post<SeatBookingOut[]>("/seating/select", body),
  orderAssignments: (orderId: string) =>
    get<SeatBookingOut[]>(`/seating/orders/${orderId}/assignments`),
};
