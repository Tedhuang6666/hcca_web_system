import type { GalleryDriveConfig, GalleryDriveStatusOut } from "../types";
import { get, post, put } from "./core";

export const gallerySyncApi = {
  status: () => get<GalleryDriveStatusOut>("/site/admin/gallery-drive"),
  configure: (body: GalleryDriveConfig) => put<GalleryDriveStatusOut>("/site/admin/gallery-drive", body),
  run: () => post<GalleryDriveStatusOut>("/site/admin/gallery-drive/run", {}),
};
