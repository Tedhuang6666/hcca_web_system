export type MapTheme = "light" | "dark";

export const MAP_MAX_ZOOM = 18;

export const MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.esri.com/en-us/arcgis/products/arcgis-online/overview">Esri</a>';

export function mapTileUrl(theme: MapTheme): string {
  return theme === "dark"
    ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
    : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
}
