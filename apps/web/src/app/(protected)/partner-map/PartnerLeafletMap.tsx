"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Coffee,
  BookOpen,
  BookmarkCheck,
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
import type { UnifiedMapItem } from "@/lib/partner-map-types";
import { businessOpenState } from "@/lib/business-hours";
import { defaultPartnerIconKey, getPartnerIcon, isPartnerIconKey } from "./partner-map-icons";
import {
  markerColor,
  markerKind,
  markerLabel,
  type MarkerKind,
  type PartnerMapBoundsState,
} from "./partner-map-utils";

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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

const iconByKind: Record<Exclude<MarkerKind, "all">, LucideIcon> = {
  drink: Coffee,
  breakfast: Croissant,
  fast_food: Sandwich,
  noodle: Soup,
  uniform: Shirt,
  retail: ShoppingBag,
  fitness: Dumbbell,
  health: HeartPulse,
  beauty: Scissors,
  repair: Wrench,
  stationery: BookOpen,
  cram_school: GraduationCap,
  copy: Printer,
  meal: UtensilsCrossed,
  other: Landmark,
};

export function markerIcon(item: UnifiedMapItem): LucideIcon {
  if (item.source === "recommended") return BookmarkCheck;
  const configuredIconKey = item.tags.find((tag) => tag.icon_key)?.icon_key;
  if (configuredIconKey && isPartnerIconKey(configuredIconKey)) return getPartnerIcon(configuredIconKey);

  const inferredIconKey = defaultPartnerIconKey([
    item.business_name,
    item.category ?? "",
    ...item.tags.map((tag) => tag.name),
  ].join(" "));
  if (inferredIconKey !== "store") return getPartnerIcon(inferredIconKey);

  return iconByKind[markerKind(item)];
}

function storeIcon(item: UnifiedMapItem) {
  const Icon = markerIcon(item);
  const iconMarkup = renderToStaticMarkup(<Icon size={14} strokeWidth={2.2} aria-hidden="true" />);
  const openState = businessOpenState(item.business_hours);
  const sourceClass = item.source === "recommended" ? "is-recommended" : "is-partner";
  const offerBadge = item.has_discount_offer
    ? '<span class="partner-map-marker-offer-badge" aria-label="折扣優惠">★</span>'
    : "";
  return divIcon({
    className: "partner-map-marker-shell",
    iconSize: [36, 36],
    iconAnchor: [18, 32],
    popupAnchor: [0, -30],
    html: `
      <div class="partner-map-marker ${sourceClass} ${openState === false ? "is-closed" : ""}" style="--marker-color: ${markerColor(item)}">
        <div class="partner-map-marker-icon">${iconMarkup}</div>
        ${offerBadge}
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
  items: UnifiedMapItem[];
  center: LatLngExpression;
  userLocation: [number, number] | null;
  onOpenBusiness: (businessId: string, source?: "partner" | "recommended") => void;
  onBoundsChange: (bounds: PartnerMapBoundsState) => void;
}) {
  const theme = useMapTheme();
  const tileUrl =
    theme === "dark"
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
  const hsinchuStation: LatLngExpression = [24.801645, 120.971703];

  return (
    <div className="h-full w-full" role="region" aria-label="特約與推薦商家互動地圖">
      <MapContainer
        center={center}
        zoom={16}
        zoomControl={false}
        className={`h-full w-full partner-map-leaflet partner-map-theme-${theme}`}
        scrollWheelZoom>
        <TileLayer
          key={theme}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url={tileUrl.replace("{r}", "")}
          detectRetina={false}
          keepBuffer={0}
          updateWhenIdle
          updateWhenZooming={false}
        />
        <ZoomControl position="bottomright" />
        <ThemeClassSync theme={theme} />
        <BoundsReporter onBoundsChange={onBoundsChange} />
        <Marker
          position={center}
          icon={landmarkIcon("school")}
          alt="新竹高中周邊地標"
          title="新竹高中周邊地標"
          eventHandlers={{
            add: (event) => {
              (event.target as { getElement?: () => HTMLElement | undefined }).getElement?.()
                ?.setAttribute("aria-label", "新竹高中周邊地標");
            },
          }}>
          <Popup>新竹高中周邊</Popup>
        </Marker>
        <Marker
          position={hsinchuStation}
          icon={landmarkIcon("station")}
          alt="新竹火車站地標"
          title="新竹火車站地標"
          eventHandlers={{
            add: (event) => {
              (event.target as { getElement?: () => HTMLElement | undefined }).getElement?.()
                ?.setAttribute("aria-label", "新竹火車站地標");
            },
          }}>
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
            })}
            alt="你的目前位置"
            title="你的目前位置"
            eventHandlers={{
              add: (event) => {
                (event.target as { getElement?: () => HTMLElement | undefined }).getElement?.()
                  ?.setAttribute("aria-label", "你的目前位置");
              },
            }}>
            <Popup>你的位置</Popup>
          </Marker>
        )}
        {items.map((item) => (
          <Marker
            key={item.location_id}
            position={[item.latitude, item.longitude]}
            icon={storeIcon(item)}
            alt={`${item.business_name}，${markerLabel(item)}。按 Enter 開啟詳情`}
            title={item.business_name}
            eventHandlers={{
              add: (event) => {
                (event.target as { getElement?: () => HTMLElement | undefined }).getElement?.()
                  ?.setAttribute("aria-label", `${item.business_name}，${markerLabel(item)}。按 Enter 開啟詳情`);
              },
              click: () => onOpenBusiness(item.business_id, item.source),
            }}>
            <Popup>
              <div className="min-w-48">
                <p className="text-sm font-semibold">{item.business_name}</p>
                <p className="mt-1 flex items-center gap-1 text-[11px] font-medium" style={{ color: markerColor(item) }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: markerColor(item) }} aria-hidden="true" />
                  {markerLabel(item)}
                </p>
                <p className="mt-1 text-xs">{item.address}</p>
                {item.has_discount_offer && <p className="mt-1 text-xs text-amber-600">★ 有折扣優惠</p>}
                {item.has_active_offer && (
                  <p className="mt-2 text-xs text-emerald-700">{item.active_offer_titles.join("、")}</p>
                )}
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-blue-700"
                  onClick={() => onOpenBusiness(item.business_id, item.source)}>
                  查看詳情
                </button>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
