"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { AtSign, Clock, Copy, ExternalLink, LocateFixed, Mail, MapPin, MessageCircle, Phone, Search, Send, Share2, Star, Tag, Trophy } from "lucide-react";
import { toast } from "sonner";
import { partnerMapApi, recommendedVendorsApi, ApiError } from "@/lib/api";
import type { PartnerBusinessDetail, PartnerBusinessDirectoryItem } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import type {
  PartnerRankingItem,
  PartnerSubmissionCreate,
  PartnerTagOut,
} from "@/lib/types";
import type { RecommendedVendorOutWithHours, UnifiedMapItem } from "@/lib/partner-map-types";
import { formatBusinessHours } from "@/lib/business-hours";
import { markerColor, markerLabel, type PartnerMapBoundsState } from "@/app/(protected)/partner-map/partner-map-utils";
import PartnerPromoCarousel, { type PartnerPromoImage } from "@/app/(protected)/partner-map/PartnerPromoCarousel";

const DEFAULT_CENTER: [number, number] = [24.795151, 120.98018];
type PartnerLeafletMapComponent = (typeof import("@/app/(protected)/partner-map/PartnerLeafletMap"))["default"];

function MapLoadingState() {
  return (
    <div className="flex h-full items-center justify-center text-sm" role="status" aria-live="polite" style={{ color: "var(--text-muted)" }}>
      互動地圖載入中…
    </div>
  );
}

function formatOffers(item: UnifiedMapItem): string {
  if (item.source === "recommended") return "推薦商家資訊";
  if (!item.has_active_offer) return "目前無有效優惠";
  return item.active_offer_titles.join("、");
}

function instagramUrl(handle: string): string {
  return `https://www.instagram.com/${handle.replace(/^@/, "")}`;
}

function externalUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function businessPath(name: string): string {
  const slug = name.trim().replace(/[/?#%\s]/g, (character) => encodeURIComponent(character));
  return `/partner-map/${slug}`;
}

function businessUrl(name: string): string {
  if (typeof window === "undefined") return businessPath(name);
  return `${window.location.origin}${businessPath(name)}`;
}

function decodeBusinessSlug(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function normalizedBusinessName(value: string): string {
  return decodeBusinessSlug(value).toLocaleLowerCase();
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) throw new Error("copy_failed");
  } finally {
    textarea.remove();
  }
}

function replacePartnerMapPath(path: string): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(window.history.state, "", path);
}

function promoImagesFor(business: PartnerBusinessDetail): PartnerPromoImage[] {
  if (business.promo_images.length > 0) return business.promo_images;
  return business.flyer_image_url
    ? [{ id: `legacy-${business.id}`, image_url: business.flyer_image_url, filename: "店家傳單" }]
    : [];
}

function attachCategoryTag<T extends { category: string | null; tags: PartnerTagOut[] }>(
  item: T,
  availableTags: PartnerTagOut[],
): T {
  const category = item.category?.trim();
  if (!category) return item;
  const categoryTag = availableTags.find((tag) => tag.is_active && tag.name.trim() === category);
  if (!categoryTag || item.tags.some((tag) => tag.name.trim() === category && tag.color)) return item;
  return {
    ...item,
    tags: [...item.tags.filter((tag) => tag.name.trim() !== category), categoryTag],
  };
}

function DetailPanel({
  business,
  loading,
  onRate,
  onCheckIn,
  onShare,
  onCopyLink,
  onClose,
}: {
  business: PartnerBusinessDetail | null;
  loading: boolean;
  onRate: (score: number) => void;
  onCheckIn: () => void;
  onShare: () => void;
  onCopyLink: () => void;
  onClose: () => void;
}) {
  if (!business && !loading) return null;
  const categoryColor = business?.tags.find((tag) => tag.name.trim() === business.category?.trim())?.color
    || "var(--primary)";
  const panel = (
    <aside
      className="partner-map-detail-panel fixed inset-x-3 bottom-3 max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-lg border p-4 shadow-xl lg:top-20 lg:right-5 lg:bottom-5 lg:left-auto lg:w-96"
      role="dialog"
      aria-modal="true"
      aria-label="特約詳情"
      style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium" style={{ color: "var(--primary)" }}>特約詳情</p>
          <h2 className="mt-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {loading ? "載入中..." : business?.name}
          </h2>
        </div>
        <button type="button" className="topbar-icon-btn" onClick={onClose} aria-label="關閉詳情">×</button>
      </div>
      {loading || !business ? (
        <div className="mt-6 text-sm" style={{ color: "var(--text-muted)" }}>載入店家資料中...</div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2" aria-label="店家連結操作">
            <button type="button" className="btn btn-secondary min-h-11 flex-1" onClick={onShare}>
              <Share2 size={15} aria-hidden="true" /> 分享店家
            </button>
            <button type="button" className="btn btn-secondary min-h-11 flex-1" onClick={onCopyLink}>
              <Copy size={15} aria-hidden="true" /> 複製連結
            </button>
          </div>
          {business.cover_image_url && (
            <Image
              src={uploadUrl(business.cover_image_url)}
              alt=""
              width={640}
              height={240}
              unoptimized
              className="h-36 w-full rounded-lg object-cover"
            />
          )}
          <PartnerPromoCarousel images={promoImagesFor(business)} businessName={business.name} />
          <div className="flex items-start gap-3">
            {business.logo_url && (
              <Image
                src={uploadUrl(business.logo_url)}
                alt=""
                width={48}
                height={48}
                unoptimized
                className="h-12 w-12 rounded-lg border object-cover"
                style={{ borderColor: "var(--border)" }}
              />
            )}
            <div className="min-w-0 flex-1">
              {business.category && (
                <p className="text-xs font-medium" style={{ color: categoryColor }}>
                  {business.category}
                </p>
              )}
              {(business.business_hours_text || formatBusinessHours(business.business_hours)) && (
                <p className="mt-1 flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  <Clock size={13} aria-hidden="true" /> {business.business_hours_text || formatBusinessHours(business.business_hours)}
                </p>
              )}
            </div>
          </div>
          {business.summary && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{business.summary}</p>}
          {business.description && (
            <section>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>合作介紹</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: "var(--text-secondary)" }}>
                {business.description}
              </p>
            </section>
          )}
          {(business.website_url || business.social_url) && (
            <a
              className="btn btn-secondary w-fit"
              href={externalUrl(business.website_url || business.social_url || "")}
              target="_blank"
              rel="noreferrer">
              前往合作頁 <ExternalLink size={15} aria-hidden="true" />
            </a>
          )}
          {business.listing_type === "online" && (
            <section className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>聯絡方式</h3>
              <div className="mt-2 space-y-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                {business.contact_name && <p>聯絡人：{business.contact_name}</p>}
                {business.contact_phone && (
                  <a className="flex items-center gap-2 hover:underline" href={`tel:${business.contact_phone}`}>
                    <Phone size={14} aria-hidden="true" /> {business.contact_phone}
                  </a>
                )}
                {business.contact_email && (
                  <a className="flex items-center gap-2 hover:underline" href={`mailto:${business.contact_email}`}>
                    <Mail size={14} aria-hidden="true" /> {business.contact_email}
                  </a>
                )}
                {business.instagram_handle && (
                  <a className="flex items-center gap-2 hover:underline" href={instagramUrl(business.instagram_handle)} target="_blank" rel="noreferrer">
                    <AtSign size={14} aria-hidden="true" /> @{business.instagram_handle.replace(/^@/, "")} <ExternalLink size={12} aria-hidden="true" />
                  </a>
                )}
                {business.line_id && (
                  <p className="flex items-center gap-2"><MessageCircle size={14} aria-hidden="true" /> LINE：{business.line_id}</p>
                )}
                {business.other_contact && <p className="whitespace-pre-wrap">{business.other_contact}</p>}
              </div>
            </section>
          )}
          {business.listing_type === "physical" && <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border-2 p-2 text-center" style={{ borderColor: "var(--primary)", background: "var(--bg-elevated)" }}>
              <p className="text-2xl font-bold" style={{ color: "var(--primary)" }}>{business.rating_avg ?? "-"}</p>
              <p className="text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>整體評價（{business.rating_count} 則）</p>
              {business.my_rating && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
                  <Star size={11} fill="currentColor" aria-hidden="true" /> 我的評分 {business.my_rating}/5
                </p>
              )}
            </div>
            <div className="rounded-lg border p-2 text-center" style={{ borderColor: "var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{business.checkin_count}</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>常去</p>
            </div>
            <div className="rounded-lg border p-2 text-center" style={{ borderColor: "var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{business.popularity_score}</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>熱度</p>
            </div>
          </div>}
          <div className="flex flex-wrap gap-2">
            {business.tags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-full px-2.5 py-1 text-xs"
                style={{ background: "var(--bg-elevated)", color: tag.color || "var(--text-secondary)" }}>
                {tag.name}
              </span>
            ))}
          </div>

          <section>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>優惠</h3>
            {business.offers.length === 0 ? (
              <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>目前沒有有效優惠</p>
            ) : (
              <div className="mt-2 space-y-2">
                {business.offers.map((offer) => (
                  <div key={offer.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{offer.title}</p>
                    {offer.public_summary && (
                      <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{offer.public_summary}</p>
                    )}
                    {offer.full_description ? (
                      <p className="mt-2 text-sm" style={{ color: "var(--text-primary)" }}>{offer.full_description}</p>
                    ) : (
                      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                        登入後可查看完整優惠內容與使用方式
                      </p>
                    )}
                    {offer.instructions && (
                      <div className="mt-3 rounded-md border p-2.5 text-xs" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
                        <p className="font-semibold" style={{ color: "var(--text-primary)" }}>使用方式：</p>
                        <p className="mt-1 whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{offer.instructions}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {business.listing_type === "physical" && business.can_view_private_details && <section>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>學生互動</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>可評價一次，之後再次選擇分數即可修改。</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  key={score}
                  className="btn px-2"
                  onClick={() => onRate(score)}
                  aria-pressed={business.my_rating === score}
                  style={business.my_rating === score
                    ? { background: "var(--primary)", color: "var(--primary-fg)", border: "2px solid var(--primary)" }
                    : undefined}>
                  <Star size={14} fill={business.my_rating === score ? "currentColor" : "none"} aria-hidden="true" /> {score}
                </button>
              ))}
              <button
                className="btn"
                onClick={onCheckIn}
                disabled={business.has_checked_in}
                style={{ background: business.has_checked_in ? "var(--bg-elevated)" : "var(--primary)", color: business.has_checked_in ? "var(--text-muted)" : "var(--primary-fg)", border: "none" }}>
                <Trophy size={14} aria-hidden="true" /> {business.has_checked_in ? "已加入常去" : "我常去"}
              </button>
            </div>
          </section>}

          {business.listing_type === "physical" && <section>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>點位</h3>
            <div className="mt-2 space-y-2">
              {business.locations.map((location) => (
                <div key={location.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {location.name || business.name}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{location.address}</p>
                  {location.phone && (
                    <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{location.phone}</p>
                  )}
                  <a
                    className="mt-2 inline-flex items-center gap-1 text-xs hover:underline"
                    style={{ color: "var(--primary)" }}
                    href={location.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`}
                    target="_blank"
                    rel="noreferrer">
                    在 Google 地圖開啟 <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </div>
              ))}
            </div>
          </section>}

          {!business.can_view_private_details && (
            <Link
              href="/login"
              className="btn w-full"
              style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
              登入查看完整優惠
            </Link>
          )}
        </div>
      )}
    </aside>
  );
  return typeof document === "undefined" ? null : createPortal(panel, document.body);
}

function RecommendedDetailPanel({
  vendor,
  onClose,
}: {
  vendor: RecommendedVendorOutWithHours | null;
  onClose: () => void;
}) {
  if (!vendor) return null;
  const panel = (
    <aside
      className="partner-map-detail-panel fixed inset-x-3 bottom-3 max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-lg border p-4 shadow-xl lg:top-20 lg:right-5 lg:bottom-5 lg:left-auto lg:w-96"
      role="dialog"
      aria-modal="true"
      aria-label="推薦商家詳情"
      style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium" style={{ color: "#2563EB" }}>推薦商家</p>
          <h2 className="mt-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{vendor.name}</h2>
        </div>
        <button className="topbar-icon-btn" onClick={onClose} aria-label="關閉推薦商家詳情">×</button>
      </div>
      <div className="mt-4 space-y-4">
        {vendor.category && <p className="text-xs font-medium" style={{ color: "#2563EB" }}>{vendor.category}</p>}
        {vendor.summary && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{vendor.summary}</p>}
        {vendor.description && (
          <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--text-secondary)" }}>{vendor.description}</p>
        )}
        {(vendor.address || vendor.contact_phone || vendor.contact_email) && (
          <section className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>店家資訊</h3>
            <div className="mt-2 space-y-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              {vendor.address && <p className="flex items-start gap-2"><MapPin size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{vendor.address}</p>}
              {vendor.contact_phone && <a className="flex items-center gap-2 hover:underline" href={`tel:${vendor.contact_phone}`}><Phone size={14} aria-hidden="true" />{vendor.contact_phone}</a>}
              {vendor.contact_email && <a className="flex items-center gap-2 hover:underline" href={`mailto:${vendor.contact_email}`}><Mail size={14} aria-hidden="true" />{vendor.contact_email}</a>}
            </div>
          </section>
        )}
        {vendor.business_hours_text && <p className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}><Clock size={14} aria-hidden="true" />{vendor.business_hours_text}</p>}
        {formatBusinessHours(vendor.business_hours) && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{formatBusinessHours(vendor.business_hours)}</p>}
        {(vendor.website_url || vendor.social_url || vendor.google_maps_url || vendor.menu_url) && (
          <div className="flex flex-wrap gap-2">
            {(vendor.website_url || vendor.social_url) && <a className="btn btn-secondary w-fit" href={externalUrl(vendor.website_url || vendor.social_url || "")} target="_blank" rel="noreferrer">前往網站 <ExternalLink size={15} aria-hidden="true" /></a>}
            {vendor.google_maps_url && <a className="btn btn-secondary w-fit" href={vendor.google_maps_url} target="_blank" rel="noreferrer">開啟地圖 <ExternalLink size={15} aria-hidden="true" /></a>}
            {vendor.menu_url && <a className="btn btn-secondary w-fit" href={vendor.menu_url} target="_blank" rel="noreferrer">查看菜單 <ExternalLink size={15} aria-hidden="true" /></a>}
          </div>
        )}
        {vendor.hygiene_verified && <p className="text-xs font-medium text-emerald-700">✓ 衛生檢驗資訊已確認</p>}
      </div>
    </aside>
  );
  return typeof document === "undefined" ? null : createPortal(panel, document.body);
}

export type PartnerMapPageProps = {
  initialBusinessSlug?: string;
  initialItems?: UnifiedMapItem[];
  initialContactBusinesses?: PartnerBusinessDirectoryItem[];
  initialTags?: PartnerTagOut[];
  initialRankings?: PartnerRankingItem[];
};

export default function PartnerMapClient({
  initialBusinessSlug,
  initialItems,
  initialContactBusinesses,
  initialTags,
  initialRankings,
}: PartnerMapPageProps = {}) {
  const [items, setItems] = useState<UnifiedMapItem[]>(initialItems ?? []);
  const [contactBusinesses, setContactBusinesses] = useState<PartnerBusinessDirectoryItem[]>(
    initialContactBusinesses ?? [],
  );
  const [tags, setTags] = useState<PartnerTagOut[]>(initialTags ?? []);
  const [keyword, setKeyword] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(initialItems === undefined);
  const [selectedBusiness, setSelectedBusiness] = useState<PartnerBusinessDetail | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<RecommendedVendorOutWithHours | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [viewportOnly, setViewportOnly] = useState(false);
  const [mapBounds, setMapBounds] = useState<PartnerMapBoundsState | null>(null);
  const [rankings, setRankings] = useState<PartnerRankingItem[]>(initialRankings ?? []);
  const [myBusinesses, setMyBusinesses] = useState<PartnerBusinessDirectoryItem[]>([]);
  const [submissionOpen, setSubmissionOpen] = useState(false);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [mapComponent, setMapComponent] = useState<PartnerLeafletMapComponent | null>(null);
  const [contactDirectoryReady, setContactDirectoryReady] = useState(
    initialContactBusinesses !== undefined,
  );
  const [initialBusinessId, setInitialBusinessId] = useState<string | null>(null);
  const [initialLinkHandled, setInitialLinkHandled] = useState(false);
  const initialBoundsReported = useRef(false);
  const [submission, setSubmission] = useState<PartnerSubmissionCreate>({
    name: "",
    category: "",
    address: "",
    google_maps_url: "",
    reason: "",
    offer_hint: "",
  });

  const activeMapBounds = viewportOnly ? mapBounds : null;
  const query = useMemo(
    () => ({
      keyword: keyword.trim(),
      tag_ids: Array.from(selectedTagIds),
      limit: "300",
      min_lat: activeMapBounds?.min_lat,
      max_lat: activeMapBounds?.max_lat,
      min_lng: activeMapBounds?.min_lng,
      max_lng: activeMapBounds?.max_lng,
    }),
    [activeMapBounds, keyword, selectedTagIds],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [partnerResult, recommendedResult] = await Promise.allSettled([
        partnerMapApi.list(query),
        recommendedVendorsApi.list({ keyword: keyword.trim() || undefined, map_only: true }),
      ]);
      const partnerItems = partnerResult.status === "fulfilled" ? partnerResult.value : [];
      if (partnerResult.status === "rejected") {
        toast.error(partnerResult.reason instanceof ApiError ? partnerResult.reason.message : "載入特約地圖失敗");
      }
      const recommendedItems = recommendedResult.status === "fulfilled"
        ? recommendedResult.value
            .filter((item) => item.latitude !== null && item.longitude !== null)
            .filter((item) => {
              if (!activeMapBounds) return true;
              return item.latitude! >= Number(activeMapBounds.min_lat)
                && item.latitude! <= Number(activeMapBounds.max_lat)
                && item.longitude! >= Number(activeMapBounds.min_lng)
                && item.longitude! <= Number(activeMapBounds.max_lng);
            })
            .map((item): UnifiedMapItem => ({
              source: "recommended",
              business_id: item.id,
              location_id: item.id,
              business_name: item.name,
              location_name: null,
              summary: item.summary,
              logo_url: null,
              cover_image_url: null,
              category: item.category,
              business_hours_text: item.business_hours_text,
              business_hours: item.business_hours ?? {},
              address: item.address ?? "",
              latitude: item.latitude!,
              longitude: item.longitude!,
              phone: item.contact_phone,
              tags: [],
              has_active_offer: false,
              has_discount_offer: false,
              active_offer_titles: [],
              rating_avg: null,
              rating_count: 0,
              popularity_score: 0,
              view_count: 0,
              checkin_count: 0,
            }))
        : [];
      if (recommendedResult.status === "rejected") {
        toast.error(recommendedResult.reason instanceof ApiError ? recommendedResult.reason.message : "載入推薦商家失敗");
      }
      setItems([...partnerItems, ...recommendedItems]);
    } finally {
      setLoading(false);
    }
  }, [activeMapBounds, keyword, query]);

  useEffect(() => {
    partnerMapApi.tags().then(setTags).catch(() => {});
    partnerMapApi.directory()
      .then(setContactBusinesses)
      .catch(() => {})
      .finally(() => setContactDirectoryReady(true));
    partnerMapApi.rankings(5).then(setRankings).catch(() => {});
    if (window.localStorage.getItem("user_id")) {
      partnerMapApi.myBusinesses().then(setMyBusinesses).catch(() => {});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void import("@/app/(protected)/partner-map/PartnerLeafletMap").then(({ default: loadedMap }) => {
      if (!cancelled) setMapComponent(() => loadedMap);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const businessId = new URLSearchParams(window.location.search).get("business");
    if (businessId) setInitialBusinessId(businessId);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handleMapBoundsChange = useCallback((bounds: PartnerMapBoundsState) => {
    setMapBounds(bounds);
    if (initialBoundsReported.current) {
      setSelectedBusiness(null);
      setSelectedVendor(null);
      setDetailLoading(false);
      replacePartnerMapPath("/partner-map");
    } else {
      initialBoundsReported.current = true;
    }
  }, []);

  const openBusiness = useCallback((businessId: string, source: "partner" | "recommended" = "partner") => {
    setSelectedBusiness(null);
    setSelectedVendor(null);
    if (source === "recommended") {
      setDetailLoading(false);
      replacePartnerMapPath("/partner-map");
      recommendedVendorsApi
        .get(businessId)
        .then(setSelectedVendor)
        .catch((error) => toast.error(error instanceof ApiError ? error.message : "載入推薦商家失敗"));
      return;
    }
    setDetailLoading(true);
    partnerMapApi.recordClick(businessId).catch(() => {});
    partnerMapApi
      .getBusiness(businessId)
      .then((business) => {
        setSelectedBusiness(business);
        replacePartnerMapPath(businessPath(business.name));
      })
      .catch((error) => toast.error(error instanceof ApiError ? error.message : "載入店家詳情失敗"))
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    if (initialLinkHandled || (!initialBusinessSlug && !initialBusinessId)) return;
    if (initialBusinessId) {
      setInitialLinkHandled(true);
      openBusiness(initialBusinessId);
      return;
    }
    if (loading || !contactDirectoryReady) return;

    const targetName = normalizedBusinessName(initialBusinessSlug ?? "");
    const target = [
      ...items.map((item) => ({ id: item.business_id, name: item.business_name })),
      ...contactBusinesses.map((business) => ({ id: business.id, name: business.name })),
    ].find((item) => normalizedBusinessName(item.name) === targetName);

    setInitialLinkHandled(true);
    if (target) {
      openBusiness(target.id);
    } else {
      replacePartnerMapPath("/partner-map");
      toast.error("找不到此特約店家");
    }
  }, [contactBusinesses, contactDirectoryReady, initialBusinessId, initialBusinessSlug, initialLinkHandled, items, loading, openBusiness]);

  const closeDetails = useCallback(() => {
    setSelectedBusiness(null);
    setSelectedVendor(null);
    setDetailLoading(false);
    replacePartnerMapPath("/partner-map");
  }, []);

  const copySelectedLink = useCallback(async () => {
    if (!selectedBusiness) return;
    try {
      await copyText(businessUrl(selectedBusiness.name));
      toast.success("店家連結已複製");
    } catch {
      toast.error("無法複製連結，請手動複製網址列");
    }
  }, [selectedBusiness]);

  const shareSelected = useCallback(async () => {
    if (!selectedBusiness) return;
    const url = businessUrl(selectedBusiness.name);
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `${selectedBusiness.name}｜特約地圖`,
          text: `查看 ${selectedBusiness.name} 的特約資訊`,
          url,
        });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    try {
      await copyText(url);
      toast.success("此裝置不支援直接分享，連結已複製");
    } catch {
      toast.error("無法分享連結，請手動複製網址列");
    }
  }, [selectedBusiness]);

  const submitNewBusiness = async () => {
    if (!submission.name?.trim()) {
      toast.error("請輸入店家名稱");
      return;
    }
    try {
      await partnerMapApi.submitBusiness({
        ...submission,
        name: submission.name.trim(),
      });
      toast.success("已送出投稿，等待管理員審核");
      setSubmissionOpen(false);
      setSubmission({ name: "", category: "", address: "", google_maps_url: "", reason: "", offer_hint: "" });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "投稿失敗");
    }
  };

  const rateSelected = async (score: number) => {
    if (!selectedBusiness) return;
    try {
      await partnerMapApi.rateBusiness(selectedBusiness.id, { rating: score, visit_count: 1, is_public: true });
      toast.success("謝謝你的評價");
      partnerMapApi.getBusiness(selectedBusiness.id).then(setSelectedBusiness);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "評價失敗");
    }
  };

  const checkInSelected = async () => {
    if (!selectedBusiness) return;
    try {
      const updated = await partnerMapApi.checkIn(selectedBusiness.id);
      setSelectedBusiness(updated);
      partnerMapApi.rankings(5).then(setRankings).catch(() => {});
      toast.success("已加入常去統計");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "更新失敗");
    }
  };

  const toggleTag = (id: string) => {
    setSelectedTagIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const center: [number, number] = DEFAULT_CENTER;
  const filteredItems = useMemo(
    () => items.map((item) => attachCategoryTag(item, tags)).sort((a, b) => b.popularity_score - a.popularity_score),
    [items, tags],
  );

  const thumbFor = (item: UnifiedMapItem) => item.logo_url || item.cover_image_url;
  const MapComponent = mapComponent;

  return (
    <div className="h-[calc(100dvh-158px)] min-h-0 overflow-hidden rounded-lg border partner-map-shell" style={{ borderColor: "var(--border)" }}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-[360px_1fr]">
        <aside className="hidden min-h-0 flex-col border-b lg:flex lg:border-b-0 lg:border-r" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
          <div className="space-y-4 p-4">
            <div>
              <div className="flex items-center justify-between gap-2"><h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>店家地圖</h1>{myBusinesses.length > 0 && <Link href="/partner-map/my-businesses" className="text-xs font-medium hover:underline" style={{ color: "var(--primary)" }}>我的店家</Link>}</div>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>以新竹高中周邊為中心，搜尋特約店家與推薦商家</p>
            </div>
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
              <Search size={16} aria-hidden="true" />
               <input
                 value={keyword}
                 onChange={(event) => setKeyword(event.target.value)}
                 name="partner-map-search"
                 autoComplete="off"
                 placeholder="搜尋店名、地址、優惠…"
                      className="min-w-0 flex-1 bg-transparent text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
                 style={{ color: "var(--text-primary)" }}
              />
            </label>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedTagIds(new Set())}
                className="flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs"
                style={{
                  borderColor: selectedTagIds.size === 0 ? "var(--primary)" : "var(--border)",
                  color: selectedTagIds.size === 0 ? "var(--primary)" : "var(--text-secondary)",
                  background: selectedTagIds.size === 0 ? "var(--primary-dim)" : "transparent",
                }}>
                全部
              </button>
              <button
                onClick={() => setViewportOnly((value) => !value)}
                className="flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs"
                style={{
                  borderColor: viewportOnly ? "var(--primary)" : "var(--border)",
                  color: viewportOnly ? "var(--primary)" : "var(--text-secondary)",
                }}>
                <LocateFixed size={13} aria-hidden="true" />
                目前視野
              </button>
              {tags.map((tag) => {
                const active = selectedTagIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className="flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs"
                    style={{
                      borderColor: active ? tag.color || "var(--primary)" : "var(--border)",
                      color: active ? tag.color || "var(--primary)" : "var(--text-secondary)",
                      background: active ? "var(--bg-elevated)" : "transparent",
                    }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color || "var(--text-muted)" }} aria-hidden="true" />
                    <Tag size={12} aria-hidden="true" />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <div className="mb-3 rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>學生常去排行</p>
                <button className="text-xs" style={{ color: "var(--primary)" }} onClick={() => setSubmissionOpen(true)}>
                  投稿新店
                </button>
              </div>
              <div className="mt-2 space-y-1">
                {rankings.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>還沒有排行資料</p>
                ) : rankings.map((item, index) => (
                  <button key={item.business_id} onClick={() => openBusiness(item.business_id)} className="flex w-full items-center gap-2 text-left">
                    <span className="w-5 text-xs font-semibold" style={{ color: "var(--primary)" }}>{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--text-secondary)" }}>{item.name}</span>
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{item.checkin_count} 次</span>
                  </button>
                ))}
              </div>
            </div>
            {contactBusinesses.length > 0 && (
              <div className="mb-3 rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>合作夥伴聯絡資訊</p>
                <div className="mt-2 space-y-2">
                  {contactBusinesses.map((business) => (
                    <button type="button" key={business.id} onClick={() => openBusiness(business.id)} className="w-full rounded-lg border p-2 text-left transition-colors hover:border-[var(--primary)]" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{business.name}</p>
                        <span className="shrink-0 text-[11px]" style={{ color: "var(--primary)" }}>查看詳情 →</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px]" style={{ color: "var(--text-muted)" }}>{business.summary || business.category || "合作聯絡窗口"}</p>
                      {business.active_offer_count > 0 && <p className="mt-1 text-[11px]" style={{ color: "var(--primary)" }}>有 {business.active_offer_count} 筆優惠</p>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {loading ? (
              <div className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
            ) : filteredItems.length === 0 ? (
              <div className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>沒有符合條件的特約店家</div>
            ) : (
               <div className="partner-map-list space-y-2">
                {filteredItems.map((item) => (
                  <button
                    key={item.location_id}
                    onClick={() => openBusiness(item.business_id, item.source)}
                    className="w-full rounded-lg border p-3 text-left transition-colors hover:border-[var(--primary)]"
                    style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
                    <div className="flex items-start justify-between gap-3">
                      {thumbFor(item) && (
                        <Image
                          src={uploadUrl(thumbFor(item)!)}
                          alt=""
                          width={48}
                          height={48}
                          unoptimized
                          className="h-12 w-12 shrink-0 rounded-lg object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{item.business_name}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium" style={{ color: markerColor(item) }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: markerColor(item) }} aria-hidden="true" />
                          {markerLabel(item)}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                          <Star size={11} aria-hidden="true" /> {item.rating_avg ?? "-"} · 熱度 {item.popularity_score}
                        </p>
                        {(item.business_hours_text || formatBusinessHours(item.business_hours)) && (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                            <Clock size={11} aria-hidden="true" /> {item.business_hours_text || formatBusinessHours(item.business_hours)}
                          </p>
                        )}
                        <p className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--text-muted)" }}>{item.address}</p>
                      </div>
                      {item.has_active_offer && (
                        <span className="shrink-0 rounded-full px-2 py-1 text-[11px]" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                          {item.has_discount_offer ? "★ 折扣" : "優惠"}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 truncate text-xs" style={{ color: "var(--text-secondary)" }}>{formatOffers(item)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="relative min-h-[360px]">
          <div className="partner-map-mobile-controls absolute left-2.5 right-2.5 top-2.5 z-[500] rounded-lg border p-3 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2"><h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>店家地圖</h1>{myBusinesses.length > 0 && <Link href="/partner-map/my-businesses" className="text-[11px] font-medium" style={{ color: "var(--primary)" }}>我的店家</Link>}</div>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>特約與推薦商家</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="partner-map-count-pill rounded-full px-2 py-1 text-[11px]">
                  {filteredItems.length} 點位
                </span>
                <button
                  type="button"
                  className="partner-map-control-toggle"
                  aria-expanded={mobileControlsOpen}
                  aria-controls="partner-map-mobile-filters"
                  onClick={() => setMobileControlsOpen((open) => !open)}>
                  <span>{mobileControlsOpen ? "收起" : "篩選"}</span>
                  <span aria-hidden="true" className={`text-sm transition-transform ${mobileControlsOpen ? "rotate-180" : ""}`}>⌄</span>
                </button>
              </div>
            </div>
            {mobileControlsOpen && (
              <div id="partner-map-mobile-filters" className="mt-2.5 space-y-2.5">
                <label className="partner-map-mobile-search flex items-center gap-2 rounded-lg border px-3 py-2.5">
                  <Search size={15} aria-hidden="true" />
                   <input
                     value={keyword}
                     onChange={(event) => setKeyword(event.target.value)}
                     name="partner-map-mobile-search"
                     autoComplete="off"
                     placeholder="搜尋店家…"
                      className="min-w-0 flex-1 bg-transparent text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
                     style={{ color: "var(--text-primary)" }}
                  />
                </label>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button
                    onClick={() => setSelectedTagIds(new Set())}
                    className="partner-map-filter-chip shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium"
                    style={{
                      ["--chip-color" as string]: selectedTagIds.size === 0 ? "var(--primary)" : "var(--text-secondary)",
                      ["--chip-border" as string]: selectedTagIds.size === 0 ? "var(--primary)" : "var(--border-strong)",
                      ["--chip-bg" as string]: selectedTagIds.size === 0 ? "var(--primary-dim)" : "var(--bg-elevated)",
                    }}
                    aria-pressed={selectedTagIds.size === 0}>
                    全部
                  </button>
                  {tags.map((tag) => {
                    const active = selectedTagIds.has(tag.id);
                    return (
                      <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                        className="partner-map-filter-chip shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium"
                        style={{
                          ["--chip-color" as string]: active ? tag.color || "var(--primary)" : "var(--text-secondary)",
                          ["--chip-border" as string]: active ? tag.color || "var(--primary)" : "var(--border-strong)",
                          ["--chip-bg" as string]: active ? "var(--bg-elevated)" : "var(--bg-elevated)",
                    }}
                    aria-pressed={active}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color || "var(--text-muted)" }} aria-hidden="true" />
                    {tag.name}
                  </button>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <button className="partner-map-mobile-action btn btn-ghost flex-1" onClick={() => setSubmissionOpen(true)}>
                    <Send size={14} aria-hidden="true" /> 投稿新店
                  </button>
                </div>
              </div>
            )}
            {contactBusinesses.length > 0 && (
              <section className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>沒有地點的特約</p>
                    <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>線上合作夥伴也在這裡</p>
                  </div>
                  <span className="rounded-full px-2 py-1 text-[11px] font-medium" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                    {contactBusinesses.length} 家
                  </span>
                </div>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {contactBusinesses.map((business) => (
                    <button type="button" key={business.id} onClick={() => openBusiness(business.id)} className="min-w-[72vw] rounded-lg border p-3 text-left" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{business.name}</p>
                        <span className="shrink-0 text-[11px]" style={{ color: "var(--primary)" }}>查看 →</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--text-secondary)" }}>{business.summary || business.category || "可線上聯絡"}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
          {MapComponent ? (
            <MapComponent
              items={filteredItems}
              center={center}
              userLocation={null}
              onOpenBusiness={openBusiness}
              onBoundsChange={handleMapBoundsChange}
            />
          ) : (
            <MapLoadingState />
          )}
          <div className="partner-map-mobile-strip absolute inset-x-0 bottom-3 z-[500] flex snap-x gap-3 overflow-x-auto px-3 pb-1 lg:hidden">
            {filteredItems.map((item) => (
              <button
                key={item.location_id}
                onClick={() => openBusiness(item.business_id, item.source)}
                className="min-w-[82vw] snap-center rounded-lg border p-3 text-left shadow-lg"
                style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
                <div className="flex items-start justify-between gap-3">
                  {thumbFor(item) && (
                    <Image
                      src={uploadUrl(thumbFor(item)!)}
                      alt=""
                      width={56}
                      height={56}
                      unoptimized
                      className="h-14 w-14 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{item.business_name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                      <Star size={11} aria-hidden="true" /> {item.rating_avg ?? "-"}
                      <span>·</span>
                      <Trophy size={11} aria-hidden="true" /> {item.checkin_count}
                    </p>
                    {(item.business_hours_text || formatBusinessHours(item.business_hours)) && (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        <Clock size={11} aria-hidden="true" /> {item.business_hours_text || formatBusinessHours(item.business_hours)}
                      </p>
                    )}
                    <p className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--text-muted)" }}>{item.address}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium" style={{ background: "var(--bg-elevated)", borderColor: markerColor(item), color: markerColor(item) }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: markerColor(item) }} aria-hidden="true" />
                    {markerLabel(item)}
                  </span>
                </div>
                <p className="mt-2 truncate text-xs" style={{ color: item.has_discount_offer ? "#B45309" : item.has_active_offer ? "var(--success)" : "var(--text-secondary)" }}>
                  {formatOffers(item)}
                </p>
              </button>
            ))}
          </div>
          {(selectedBusiness || selectedVendor || detailLoading) && typeof document !== "undefined" && createPortal(
            <button
              type="button"
              className="partner-map-detail-backdrop fixed inset-0 lg:hidden"
              aria-label="關閉特約詳情"
              onClick={closeDetails}
            />,
            document.body,
          )}
          <DetailPanel
            business={selectedBusiness ? attachCategoryTag(selectedBusiness, tags) : null}
            loading={detailLoading}
            onRate={rateSelected}
            onCheckIn={checkInSelected}
            onShare={shareSelected}
            onCopyLink={copySelectedLink}
            onClose={closeDetails}
          />
          <RecommendedDetailPanel
            vendor={selectedVendor}
            onClose={closeDetails}
          />
          <div className="pointer-events-none absolute left-4 top-4 hidden rounded-lg border px-3 py-2 text-xs shadow lg:block" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden="true" /> {filteredItems.length} 個點位</span>
          </div>
          {submissionOpen && typeof document !== "undefined" && createPortal(
            <div className="partner-map-submit-dialog fixed inset-0 flex items-start justify-center overflow-y-auto p-4 sm:items-center" style={{ background: "var(--bg-overlay)" }}>
              <div className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg border p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="partner-map-submit-title" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 id="partner-map-submit-title" className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>投稿新店家</h2>
                    <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>推薦你希望加入特約地圖的店家</p>
                  </div>
                  <button className="topbar-icon-btn" onClick={() => setSubmissionOpen(false)} aria-label="關閉投稿">×</button>
                </div>
                <div className="mt-4 grid gap-3">
                  <label className="grid gap-1.5 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                    店家名稱
                    <input
                      className="input"
                      name="business-name"
                      autoComplete="organization"
                      placeholder="例如：沃爾創意行銷"
                      value={submission.name}
                      onChange={(e) => setSubmission((s) => ({ ...s, name: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                    類型
                    <input
                      className="input"
                      name="business-category"
                      placeholder="例如：飲料、早餐、文具、補習班"
                      value={submission.category ?? ""}
                      onChange={(e) => setSubmission((s) => ({ ...s, category: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                    地址
                    <input
                      className="input"
                      name="business-address"
                      autoComplete="street-address"
                      placeholder="例如：新竹市東區學府路 1 號"
                      value={submission.address ?? ""}
                      onChange={(e) => setSubmission((s) => ({ ...s, address: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                    Google Maps 連結
                    <input
                      className="input"
                      name="google-maps-url"
                      type="url"
                      inputMode="url"
                      placeholder="可直接貼上地圖連結"
                      value={submission.google_maps_url ?? ""}
                      onChange={(e) => setSubmission((s) => ({ ...s, google_maps_url: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                    推薦原因
                    <textarea
                      className="input min-h-20"
                      name="submission-reason"
                      placeholder="為什麼推薦這間店家？"
                      value={submission.reason ?? ""}
                      onChange={(e) => setSubmission((s) => ({ ...s, reason: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                    可能的特約優惠
                    <input
                      className="input"
                      name="offer-hint"
                      placeholder="例如：學生證九折"
                      value={submission.offer_hint ?? ""}
                      onChange={(e) => setSubmission((s) => ({ ...s, offer_hint: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button className="btn btn-ghost" onClick={() => setSubmissionOpen(false)}>取消</button>
                  <button className="btn" onClick={submitNewBusiness} style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
                    <Send size={15} aria-hidden="true" /> 送出投稿
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}
        </main>
      </div>
    </div>
  );
}
