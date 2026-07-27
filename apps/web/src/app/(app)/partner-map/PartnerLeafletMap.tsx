"use client";

import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Coffee,
  BookOpen,
  Croissant,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Landmark,
  Printer,
  Scissors,
  Sandwich,
  School,
  Shirt,
  ShoppingBag,
  Soup,
  TrainFront,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap } from "react-leaflet";
import type { LatLngBounds, LatLngExpression } from "leaflet";
import type { PartnerMapItem } from "@/lib/types";
import { getPartnerIcon } from "./partner-map-icons";

export type PartnerMapBoundsState = {
  min_lat: string;
  max_lat: string;
  min_lng: string;
  max_lng: string;
};

function toBoundsState(bounds: LatLngBounds): PartnerMapBoundsState {
  return {
    min_lat: String(bounds.getSouth()),
    max_lat: String(bounds.getNorth()),
    min_lng: String(bounds.getWest()),
    max_lng: String(bounds.getEast()),
  };
}

function BoundsReporter({ onBoundsChange }: { onBoundsChange: (bounds: PartnerMapBoundsState) => void }) {
  const map = useMap();
  const lastBoundsKey = useRef<string | null>(null);
  const onBoundsChangeRef = useRef(onBoundsChange);
  onBoundsChangeRef.current = onBoundsChange;

  useEffect(() => {
    const reportBounds = () => {
      const bounds = toBoundsState(map.getBounds());
      const boundsKey = JSON.stringify(bounds);
      if (lastBoundsKey.current === boundsKey) return;
      lastBoundsKey.current = boundsKey;
      onBoundsChangeRef.current(bounds);
    };
    const eventHandlers = {
      movestart: () => map.closePopup(),
      zoomstart: () => map.closePopup(),
      moveend: reportBounds,
      zoomend: reportBounds,
    };

    map.on(eventHandlers);
    reportBounds();
    return () => {
      map.off(eventHandlers);
    };
  }, [map]);

  return null;
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

export type MarkerKind =
  | "all"
  | "drink"
  | "breakfast"
  | "fast_food"
  | "noodle"
  | "uniform"
  | "retail"
  | "fitness"
  | "health"
  | "beauty"
  | "repair"
  | "stationery"
  | "cram_school"
  | "copy"
  | "meal"
  | "other";

export const MARKER_CONFIG: Record<Exclude<MarkerKind, "all">, { label: string; color: string; icon: LucideIcon }> = {
  drink: { label: "飲料", color: "#EC4899", icon: Coffee },
  breakfast: { label: "早餐", color: "#F97316", icon: Croissant },
  fast_food: { label: "速食", color: "#EF4444", icon: Sandwich },
  noodle: { label: "麵店", color: "#F59E0B", icon: Soup },
  uniform: { label: "制服", color: "#0F766E", icon: Shirt },
  retail: { label: "零售", color: "#DB2777", icon: ShoppingBag },
  fitness: { label: "運動", color: "#2563EB", icon: Dumbbell },
  health: { label: "健康", color: "#059669", icon: HeartPulse },
  beauty: { label: "美容", color: "#C026D3", icon: Scissors },
  repair: { label: "維修", color: "#7C3AED", icon: Wrench },
  stationery: { label: "文具", color: "#8B5CF6", icon: BookOpen },
  cram_school: { label: "補習班", color: "#3B82F6", icon: GraduationCap },
  copy: { label: "影印", color: "#64748B", icon: Printer },
  meal: { label: "餐飲", color: "#10B981", icon: UtensilsCrossed },
  other: { label: "特約", color: "#C9A84C", icon: Landmark },
};

export function markerKind(item: PartnerMapItem): Exclude<MarkerKind, "all"> {
  const text = [
    item.business_name,
    item.summary ?? "",
    item.category ?? "",
    ...item.tags.map((tag) => tag.name),
  ].join(" ");
  if (/飲料|手搖|茶|咖啡|果汁|冰品|豆花/.test(text)) return "drink";
  if (/早餐|早午餐|蛋餅|飯糰|吐司|漢堡蛋/.test(text)) return "breakfast";
  if (/速食|漢堡|炸雞|披薩|薯條|三明治/.test(text)) return "fast_food";
  if (/麵|拉麵|牛肉麵|乾麵|湯麵|麵線|意麵/.test(text)) return "noodle";
  if (/制服|服飾|成衣|鞋|衣服|皮件|修改衣/.test(text)) return "uniform";
  if (/商店|零售|百貨|購物|雜貨|超商|生活用品/.test(text)) return "retail";
  if (/健身|運動|體育|瑜珈/.test(text)) return "fitness";
  if (/診所|藥局|牙醫|醫療|健康/.test(text)) return "health";
  if (/美髮|髮廊|美容|美甲|美妝/.test(text)) return "beauty";
  if (/修理|維修|洗衣|鎖店/.test(text)) return "repair";
  if (/文具|書局|筆|紙|美術|用品/.test(text)) return "stationery";
  if (/補習|升學|家教|英文|數學|物理|化學/.test(text)) return "cram_school";
  if (/影印|列印|印刷|輸出|裝訂/.test(text)) return "copy";
  if (/餐|飯|便當|小吃|滷味|鍋|早餐|午餐|晚餐/.test(text)) return "meal";
  return "other";
}

function safeMarkerColor(value: string | null | undefined, fallback: string): string {
  const color = value?.trim() ?? "";
  return /^#[\da-f]{3,8}$/i.test(color) ? color : fallback;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function markerLabel(item: PartnerMapItem): string {
  return item.category?.trim() || item.tags.find((tag) => tag.name.trim())?.name.trim() || MARKER_CONFIG[markerKind(item)].label;
}

export function markerColor(item: PartnerMapItem): string {
  const fallback = MARKER_CONFIG[markerKind(item)].color;
  return safeMarkerColor(item.tags.find((tag) => tag.color)?.color, fallback);
}

export function markerIcon(item: PartnerMapItem): LucideIcon {
  const configuredIconKey = item.tags.find((tag) => tag.icon_key)?.icon_key;
  if (configuredIconKey) return getPartnerIcon(configuredIconKey);
  return MARKER_CONFIG[markerKind(item)].icon;
}

function storeIcon(item: PartnerMapItem) {
  const Icon = markerIcon(item);
  const iconMarkup = renderToStaticMarkup(<Icon size={17} strokeWidth={2.4} aria-hidden="true" />);
  return divIcon({
    className: "partner-map-marker-shell",
    iconSize: [44, 44],
    iconAnchor: [22, 40],
    popupAnchor: [0, -38],
    html: `
      <div class="partner-map-marker ${item.has_active_offer ? "has-offer" : ""}" style="--marker-color: ${markerColor(item)}">
        <div class="partner-map-marker-icon">${iconMarkup}</div>
        <div class="partner-map-marker-label" title="${escapeHtml(markerLabel(item))}">${escapeHtml(markerLabel(item))}</div>
      </div>
    `,
  });
}

function landmarkIcon(kind: "school" | "station") {
  if (kind === "station") {
    const iconMarkup = renderToStaticMarkup(<TrainFront size={19} strokeWidth={2.4} aria-hidden="true" />);
    return divIcon({
      className: "partner-map-marker-shell",
      iconSize: [36, 42],
      iconAnchor: [18, 36],
      popupAnchor: [0, -34],
      html: `<div class="partner-map-station-marker">${iconMarkup}</div>`,
    });
  }

  const iconMarkup = renderToStaticMarkup(<School size={22} strokeWidth={2.3} aria-hidden="true" />);
  return divIcon({
    className: "partner-map-marker-shell",
    iconSize: [36, 42],
    iconAnchor: [18, 36],
    popupAnchor: [0, -34],
    html: `<div class="partner-map-school-marker">${iconMarkup}</div>`,
  });
}

function useMapTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => {
      setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export default function PartnerLeafletMap({
  items,
  center,
  userLocation,
  onOpenBusiness,
  onBoundsChange,
}: {
  items: PartnerMapItem[];
  center: LatLngExpression;
  userLocation: [number, number] | null;
  onOpenBusiness: (businessId: string) => void;
  onBoundsChange: (bounds: PartnerMapBoundsState) => void;
}) {
  const theme = useMapTheme();
  const tileUrl =
    theme === "dark"
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
  const hsinchuStation: LatLngExpression = [24.801645, 120.971703];

  return (
    <MapContainer
      center={center}
      zoom={16}
      zoomControl={false}
      className={`h-full w-full partner-map-leaflet partner-map-theme-${theme}`}
      scrollWheelZoom>
      <TileLayer
        key={theme}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url={tileUrl}
      />
      <ZoomControl position="bottomright" />
      <ThemeClassSync theme={theme} />
      <BoundsReporter onBoundsChange={onBoundsChange} />
      <Marker
        position={center}
        icon={landmarkIcon("school")}>
        <Popup>新竹高中周邊</Popup>
      </Marker>
      <Marker
        position={hsinchuStation}
        icon={landmarkIcon("station")}>
        <Popup>新竹火車站</Popup>
      </Marker>
      {userLocation && (
        <Marker
          position={userLocation}
          icon={divIcon({
            className: "partner-map-marker-shell",
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            html: '<div class="partner-map-user-marker"></div>',
          })}>
          <Popup>你的位置</Popup>
        </Marker>
      )}
      {items.map((item) => (
        <Marker
          key={item.location_id}
          position={[item.latitude, item.longitude]}
          icon={storeIcon(item)}
          eventHandlers={{ click: () => onOpenBusiness(item.business_id) }}>
          <Popup>
            <div className="min-w-48">
              <p className="text-sm font-semibold">{item.business_name}</p>
              <p className="mt-1 flex items-center gap-1 text-[11px] font-medium" style={{ color: markerColor(item) }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: markerColor(item) }} aria-hidden="true" />
                {markerLabel(item)}
              </p>
              <p className="mt-1 text-xs">{item.address}</p>
              {item.has_active_offer && (
                <p className="mt-2 text-xs text-emerald-700">{item.active_offer_titles.join("、")}</p>
              )}
              <button
                type="button"
                className="mt-2 text-xs font-medium text-blue-700"
                onClick={() => onOpenBusiness(item.business_id)}>
                查看詳情
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
