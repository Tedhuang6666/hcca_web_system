import { get, patch, post } from "./core";
import type { ShortLinkCreate, ShortLinkOut, ShortLinkUpdate } from "../api-bridge";

export const shortLinksApi = {
  list: () => get<ShortLinkOut[]>("/short-links"),
  create: (body: ShortLinkCreate) => post<ShortLinkOut>("/short-links", body),
  update: (id: string, body: ShortLinkUpdate) =>
    patch<ShortLinkOut>(`/short-links/${encodeURIComponent(id)}`, body),
};
