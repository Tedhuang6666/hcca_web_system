"use client";

import { renderToStaticMarkup } from "react-dom/server";
import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { divIcon, LatLngBounds } from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap } from "react-leaflet";
import type { RecommendedVendorListItem } from "@/lib/types";

function FitBounds({ items }: { items: RecommendedVendorListItem[] }) {
  const map = useMap();
  useEffect(() => {
    if (items.length === 0) return;
    const bounds = new LatLngBounds(items.map((item) => [item.latitude!, item.longitude!]));
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
  }, [items, map]);
  return null;
}

function useMapTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function ThemeClassSync({ theme }: { theme: "light" | "dark" }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    container.classList.toggle("partner-map-theme-dark", theme === "dark");
    container.classList.toggle("partner-map-theme-light", theme === "light");
  }, [map, theme]);

  return null;
}

function vendorIcon() {
  const icon = renderToStaticMarkup(<Store size={18} strokeWidth={2.4} aria-hidden="true" />);
  return divIcon({
    className: "partner-map-marker-shell",
    iconSize: [44, 44],
    iconAnchor: [22, 40],
    popupAnchor: [0, -38],
    html: `<div class="partner-map-marker" style="--marker-color:#15803D"><div class="partner-map-marker-icon">${icon}</div><div class="partner-map-marker-label">推薦</div></div>`,
  });
}

export default function RecommendedVendorMap({
  items,
  onSelect,
}: {
  items: RecommendedVendorListItem[];
  onSelect: (id: string) => void;
}) {
  const theme = useMapTheme();
  const mapped = items.filter((item) => item.latitude !== null && item.longitude !== null);
  const center: [number, number] = mapped.length > 0
    ? [mapped[0].latitude!, mapped[0].longitude!]
    : [24.795151, 120.98018];

  return (
    <MapContainer
      center={center}
      zoom={15}
      zoomControl={false}
      scrollWheelZoom
      className={`h-full w-full partner-map-leaflet partner-map-theme-${theme}`}>
      <TileLayer
        key={theme}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url={theme === "dark"
          ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"}
      />
      <ZoomControl position="bottomright" />
      <ThemeClassSync theme={theme} />
      <FitBounds items={mapped} />
      {mapped.map((item) => (
        <Marker key={item.id} position={[item.latitude!, item.longitude!]} icon={vendorIcon()}>
          <Popup>
            <div className="space-y-1 text-sm">
              <strong>{item.name}</strong>
              {item.address && <p>{item.address}</p>}
              <button type="button" className="font-medium underline" style={{ color: "var(--primary)" }} onClick={() => onSelect(item.id)}>
                查看商家資訊
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
