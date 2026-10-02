export type MapTheme = "light" | "dark";

export const MAP_MAX_ZOOM = 18;

export const MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const PARTNER_MAP_STYLE_ATTRIBUTION =
  '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a> &middot; &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &middot; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function partnerMapStyleUrl(theme: MapTheme): string {
  return `https://tiles.openfreemap.org/styles/${theme === "dark" ? "dark" : "positron"}`;
}

export function mapTileUrl(): string {
  return "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
}
