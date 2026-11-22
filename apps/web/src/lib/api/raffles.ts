import type {
  RaffleAdminOut,
  RaffleDrawOut,
  RaffleJoinOut,
  RaffleNextOut,
  RafflePrizeInput,
  RaffleStatus,
} from "../types";
import { get, patch, post } from "./core";

export interface RaffleActivateInput {
  access_code: string;
  prizes?: RafflePrizeInput[];
}

export const rafflesApi = {
  ping: () => get<void>("/raffles/ping"),
  join: (body: { access_code: string; device_id?: string }) =>
    post<RaffleJoinOut>("/raffles/join", body),
  restore: (sessionToken: string) =>
    get<RaffleJoinOut>(`/raffles/session?session_token=${encodeURIComponent(sessionToken)}`),
  draw: (sessionToken: string, idempotencyKey: string) =>
    post<RaffleDrawOut>("/raffles/draw", {
      session_token: sessionToken,
      idempotency_key: idempotencyKey,
    }),
  next: (sessionToken: string) =>
    post<RaffleNextOut>("/raffles/next", { session_token: sessionToken }),
  list: () => get<RaffleAdminOut[]>("/raffles"),
  create: (body: RaffleActivateInput) => post<RaffleAdminOut>("/raffles", body),
  update: (
    id: string,
    body: { status?: RaffleStatus; reserve_released?: boolean; prizes?: RafflePrizeInput[] },
  ) =>
    patch<RaffleAdminOut>(`/raffles/${id}`, body),
  reset: (id: string) => post<RaffleAdminOut>(`/raffles/${id}/reset`, {}),
};
