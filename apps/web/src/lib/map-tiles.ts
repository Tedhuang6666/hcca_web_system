export type MapTheme = "light" | "dark";

export const MAP_MAX_ZOOM = 18;

export const MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function mapTileUrl(): string {
  return "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
}
