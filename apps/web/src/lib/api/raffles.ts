import type {
  RaffleAdminOut,
  RaffleDrawOut,
  RaffleJoinOut,
  RaffleStatus,
} from "../types";
import { get, patch, post } from "./core";

export interface RafflePrizeCreateInput {
  tier: string;
  name: string;
  quantity: number | null;
  sort_order: number;
}

export interface RaffleCreateInput {
  event_code: string;
  title: string;
  description?: string | null;
  access_code: string;
  prizes: RafflePrizeCreateInput[];
}

export const rafflesApi = {
  ping: () => get<void>("/raffles/ping"),
  join: (body: { event_code: string; access_code: string; device_id?: string }) =>
    post<RaffleJoinOut>("/raffles/join", body),
  restore: (sessionToken: string) =>
    get<RaffleJoinOut>(`/raffles/session?session_token=${encodeURIComponent(sessionToken)}`),
  draw: (sessionToken: string, idempotencyKey: string) =>
    post<RaffleDrawOut>("/raffles/draw", {
      session_token: sessionToken,
      idempotency_key: idempotencyKey,
    }),
  list: () => get<RaffleAdminOut[]>("/raffles"),
  create: (body: RaffleCreateInput) => post<RaffleAdminOut>("/raffles", body),
  update: (id: string, body: { status: RaffleStatus; reserve_released?: boolean }) =>
    patch<RaffleAdminOut>(`/raffles/${id}`, body),
};
