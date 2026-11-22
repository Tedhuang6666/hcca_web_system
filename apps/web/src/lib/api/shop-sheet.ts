import type { ShopSheetSourceCreate, ShopSheetSourceOut, ShopSheetRowOut, ShopSheetSyncOut } from "../types";
import { get, patch, post, put } from "./core";

export const shopSheetApi = {
  list: () => get<ShopSheetSourceOut[]>("/shop/sheet-sources"),
  create: (body: ShopSheetSourceCreate) => post<ShopSheetSourceOut>("/shop/sheet-sources", body),
  configure: (id: string, body: ShopSheetSourceCreate) => put<ShopSheetSourceOut>(`/shop/sheet-sources/${id}`, body),
  enable: (id: string, enabled: boolean) => patch<ShopSheetSourceOut>(`/shop/sheet-sources/${id}/enabled`, { enabled }),
  sync: (id: string) => post<ShopSheetSyncOut>(`/shop/sheet-sources/${id}/sync`, {}),
  rows: (id: string, offset = 0) => get<ShopSheetRowOut[]>(`/shop/sheet-sources/${id}/rows?offset=${offset}&limit=100`),
};
