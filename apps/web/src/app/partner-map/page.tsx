"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { AtSign, Clock, ExternalLink, LocateFixed, Mail, MapPin, MessageCircle, Navigation, Phone, Search, Send, SlidersHorizontal, Star, Tag, Trophy } from "lucide-react";
import { toast } from "sonner";
import { partnerMapApi, ApiError } from "@/lib/api";
import type { PartnerBusinessDetail, PartnerBusinessDirectoryItem } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import type {
  PartnerMapItem,
  PartnerRankingItem,
  PartnerSubmissionCreate,
  PartnerTagOut,
} from "@/lib/types";
import {
  MARKER_CONFIG,
  markerKind,
  type PartnerMapBoundsState,
} from "./PartnerLeafletMap";

const DEFAULT_CENTER: [number, number] = [24.795151, 120.98018];
const PartnerLeafletMap = dynamic(() => import("./PartnerLeafletMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>
      載入地圖中...
    </div>
  ),
});

function formatOffers(item: PartnerMapItem): string {
  if (!item.has_active_offer) return "目前無有效優惠";
  return item.active_offer_titles.join("、");
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const toRad = (value: number) => value * Math.PI / 180;
  const earth = 6371000;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(h));
}

function distanceText(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function instagramUrl(handle: string): string {
  return `https://www.instagram.com/${handle.replace(/^@/, "")}`;
}

function externalUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function DetailPanel({
  business,
  loading,
  onRate,
  onCheckIn,
  onClose,
}: {
  business: PartnerBusinessDetail | null;
  loading: boolean;
  onRate: (score: number) => void;
  onCheckIn: () => void;
  onClose: () => void;
}) {
  if (!business && !loading) return null;
  return (
    <aside
      className="fixed inset-x-3 bottom-3 z-[600] max-h-[70vh] overflow-y-auto rounded-lg border p-4 shadow-xl lg:absolute lg:inset-y-4 lg:right-4 lg:left-auto lg:w-96"
      style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium" style={{ color: "var(--primary)" }}>特約詳情</p>
          <h2 className="mt-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {loading ? "載入中..." : business?.name}
          </h2>
        </div>
        <button className="topbar-icon-btn" onClick={onClose} aria-label="關閉詳情">×</button>
      </div>
      {loading || !business ? (
        <div className="mt-6 text-sm" style={{ color: "var(--text-muted)" }}>載入店家資料中...</div>
      ) : (
        <div className="mt-4 space-y-4">
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
                <p className="text-xs font-medium" style={{ color: "var(--primary)" }}>
                  {business.category}
                </p>
              )}
              {business.business_hours_text && (
                <p className="mt-1 flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  <Clock size={13} aria-hidden="true" /> {business.business_hours_text}
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
            <div className="rounded-lg border p-2 text-center" style={{ borderColor: "var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{business.rating_avg ?? "-"}</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>評價</p>
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

          {business.listing_type === "physical" && <section>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>學生互動</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((score) => (
                <button key={score} className="btn btn-ghost px-2" onClick={() => onRate(score)}>
                  <Star size={14} aria-hidden="true" /> {score}
                </button>
              ))}
              <button className="btn" onClick={onCheckIn} style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
                <Trophy size={14} aria-hidden="true" /> 我常去
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
}

export default function PartnerMapPage() {
  const [items, setItems] = useState<PartnerMapItem[]>([]);
  const [contactBusinesses, setContactBusinesses] = useState<PartnerBusinessDirectoryItem[]>([]);
  const [tags, setTags] = useState<PartnerTagOut[]>([]);
  const [keyword, setKeyword] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [offerOnly, setOfferOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedBusiness, setSelectedBusiness] = useState<PartnerBusinessDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [viewportOnly, setViewportOnly] = useState(false);
  const [mapBounds, setMapBounds] = useState<PartnerMapBoundsState | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [sortMode, setSortMode] = useState<"popular" | "nearest">("popular");
  const [rankings, setRankings] = useState<PartnerRankingItem[]>([]);
  const [submissionOpen, setSubmissionOpen] = useState(false);
  const [submission, setSubmission] = useState<PartnerSubmissionCreate>({
    name: "",
    category: "",
    address: "",
    reason: "",
    offer_hint: "",
  });

  const activeMapBounds = viewportOnly ? mapBounds : null;
  const query = useMemo(
    () => ({
      keyword: keyword.trim(),
      tag_ids: Array.from(selectedTagIds),
      has_active_offer: offerOnly,
      limit: "300",
      min_lat: activeMapBounds?.min_lat,
      max_lat: activeMapBounds?.max_lat,
      min_lng: activeMapBounds?.min_lng,
      max_lng: activeMapBounds?.max_lng,
    }),
    [activeMapBounds, keyword, offerOnly, selectedTagIds],
  );

  const load = useCallback(() => {
    setLoading(true);
    partnerMapApi
      .list(query)
      .then(setItems)
      .catch((error) => toast.error(error instanceof ApiError ? error.message : "載入特約地圖失敗"))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    partnerMapApi.tags().then(setTags).catch(() => {});
    partnerMapApi.directory().then(setContactBusinesses).catch(() => {});
    partnerMapApi.rankings(5).then(setRankings).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handleMapBoundsChange = useCallback((bounds: PartnerMapBoundsState) => {
    setMapBounds(bounds);
    setSelectedBusiness(null);
    setDetailLoading(false);
  }, []);

  const openBusiness = (businessId: string) => {
    setSelectedBusiness(null);
    setDetailLoading(true);
    partnerMapApi.recordClick(businessId).catch(() => {});
    partnerMapApi
      .getBusiness(businessId)
      .then(setSelectedBusiness)
      .catch((error) => toast.error(error instanceof ApiError ? error.message : "載入店家詳情失敗"))
      .finally(() => setDetailLoading(false));
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      toast.error("此瀏覽器不支援定位");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation([position.coords.latitude, position.coords.longitude]);
        setSortMode("nearest");
        toast.success("已取得目前位置");
      },
      () => toast.error("無法取得定位，請確認瀏覽器權限"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const submitNewBusiness = async () => {
    if (!submission.name?.trim()) {
      toast.error("請輸入店家名稱");
      return;
    }
    try {
      await partnerMapApi.submitBusiness({
        ...submission,
        name: submission.name.trim(),
        latitude: userLocation?.[0] ?? null,
        longitude: userLocation?.[1] ?? null,
      });
      toast.success("已送出投稿，等待管理員審核");
      setSubmissionOpen(false);
      setSubmission({ name: "", category: "", address: "", reason: "", offer_hint: "" });
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
    () => {
      const filtered = [...items];
      if (sortMode === "nearest" && userLocation) {
        filtered.sort(
          (a, b) =>
            distanceMeters(userLocation, [a.latitude, a.longitude])
            - distanceMeters(userLocation, [b.latitude, b.longitude]),
        );
      } else {
        filtered.sort((a, b) => b.popularity_score - a.popularity_score);
      }
      return filtered;
    },
    [items, sortMode, userLocation],
  );

  const thumbFor = (item: PartnerMapItem) => item.logo_url || item.cover_image_url;

  return (
    <div className="h-[calc(100dvh-92px)] min-h-[620px] overflow-hidden rounded-lg border partner-map-shell" style={{ borderColor: "var(--border)" }}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-[360px_1fr]">
        <aside className="hidden min-h-0 flex-col border-b lg:flex lg:border-b-0 lg:border-r" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
          <div className="space-y-4 p-4">
            <div>
              <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>特約地圖</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>以新竹高中周邊為中心，搜尋校園特約店家與有效優惠</p>
            </div>
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
              <Search size={16} aria-hidden="true" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜尋店名、地址、優惠"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
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
                onClick={() => setOfferOnly((value) => !value)}
                className="flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs"
                style={{
                  borderColor: offerOnly ? "var(--primary)" : "var(--border)",
                  color: offerOnly ? "var(--primary)" : "var(--text-secondary)",
                }}>
                <SlidersHorizontal size={13} aria-hidden="true" />
                有優惠
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
              <button onClick={locateMe} className="flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                <Navigation size={13} aria-hidden="true" /> 離我最近
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
                    <Tag size={13} aria-hidden="true" />
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
              <div className="space-y-2">
                {filteredItems.map((item) => (
                  <button
                    key={item.location_id}
                    onClick={() => openBusiness(item.business_id)}
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
                        <p className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                          <Star size={11} aria-hidden="true" /> {item.rating_avg ?? "-"} · 熱度 {item.popularity_score}
                        </p>
                        {item.business_hours_text && (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                            <Clock size={11} aria-hidden="true" /> {item.business_hours_text}
                          </p>
                        )}
                        <p className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--text-muted)" }}>{item.address}</p>
                      </div>
                      {item.has_active_offer && (
                        <span className="shrink-0 rounded-full px-2 py-1 text-[11px]" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                          優惠
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
          <div className="partner-map-mobile-controls absolute left-2.5 right-2.5 top-2.5 z-[500] space-y-2.5 rounded-lg border p-3 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>特約地圖</h1>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>新竹高中周邊</p>
              </div>
              <span className="partner-map-count-pill rounded-full px-2 py-1 text-[11px]">
                {filteredItems.length} 點位
              </span>
            </div>
            <label className="partner-map-mobile-search flex items-center gap-2 rounded-lg border px-3 py-2.5">
              <Search size={15} aria-hidden="true" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜尋店家"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
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
                    {tag.name}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button className="partner-map-mobile-action btn btn-ghost flex-1" onClick={locateMe}>
                <Navigation size={14} aria-hidden="true" /> 離我最近
              </button>
              <button className="partner-map-mobile-action btn btn-ghost flex-1" onClick={() => setSubmissionOpen(true)}>
                <Send size={14} aria-hidden="true" /> 投稿新店
              </button>
            </div>
            {contactBusinesses.length > 0 && (
              <div className="rounded-lg border p-2" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>合作夥伴聯絡資訊</p>
                <div className="mt-2 max-h-24 space-y-1 overflow-y-auto">
                  {contactBusinesses.map((business) => (
                    <button type="button" key={business.id} onClick={() => openBusiness(business.id)} className="flex w-full items-center justify-between gap-2 text-left text-xs" style={{ color: "var(--primary)" }}>
                      <span className="truncate">{business.name}</span><span className="shrink-0">查看詳情 →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <PartnerLeafletMap
            items={filteredItems}
            center={center}
            userLocation={userLocation}
            onOpenBusiness={openBusiness}
            onBoundsChange={handleMapBoundsChange}
          />
          <div className="partner-map-mobile-strip absolute inset-x-0 bottom-3 z-[500] flex snap-x gap-3 overflow-x-auto px-3 pb-1 lg:hidden">
            {filteredItems.map((item) => (
              <button
                key={item.location_id}
                onClick={() => openBusiness(item.business_id)}
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
                      {userLocation && <span>· {distanceText(distanceMeters(userLocation, [item.latitude, item.longitude]))}</span>}
                    </p>
                    {item.business_hours_text && (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        <Clock size={11} aria-hidden="true" /> {item.business_hours_text}
                      </p>
                    )}
                    <p className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--text-muted)" }}>{item.address}</p>
                  </div>
                  <span className="shrink-0 rounded-full px-2 py-1 text-[11px]" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                    {MARKER_CONFIG[markerKind(item)].label}
                  </span>
                </div>
                <p className="mt-2 truncate text-xs" style={{ color: item.has_active_offer ? "var(--success)" : "var(--text-secondary)" }}>
                  {formatOffers(item)}
                </p>
              </button>
            ))}
          </div>
          <DetailPanel
            business={selectedBusiness}
            loading={detailLoading}
            onRate={rateSelected}
            onCheckIn={checkInSelected}
            onClose={() => {
              setSelectedBusiness(null);
              setDetailLoading(false);
            }}
          />
          <div className="pointer-events-none absolute left-4 top-4 hidden rounded-lg border px-3 py-2 text-xs shadow lg:block" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden="true" /> {filteredItems.length} 個點位</span>
          </div>
          {submissionOpen && (
            <div className="fixed inset-0 z-[700] grid place-items-center p-4" style={{ background: "var(--bg-overlay)" }}>
              <div className="w-full max-w-lg rounded-lg border p-5 shadow-xl" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>投稿新店家</h2>
                    <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>推薦你希望加入特約地圖的店家</p>
                  </div>
                  <button className="topbar-icon-btn" onClick={() => setSubmissionOpen(false)} aria-label="關閉投稿">×</button>
                </div>
                <div className="mt-4 grid gap-3">
                  <input className="input" placeholder="店家名稱" value={submission.name} onChange={(e) => setSubmission((s) => ({ ...s, name: e.target.value }))} />
                  <input className="input" placeholder="類型，例如 飲料 / 早餐 / 文具 / 補習班" value={submission.category ?? ""} onChange={(e) => setSubmission((s) => ({ ...s, category: e.target.value }))} />
                  <input className="input" placeholder="地址" value={submission.address ?? ""} onChange={(e) => setSubmission((s) => ({ ...s, address: e.target.value }))} />
                  <textarea className="input min-h-20" placeholder="推薦原因" value={submission.reason ?? ""} onChange={(e) => setSubmission((s) => ({ ...s, reason: e.target.value }))} />
                  <input className="input" placeholder="可能的特約優惠，例如 學生證九折" value={submission.offer_hint ?? ""} onChange={(e) => setSubmission((s) => ({ ...s, offer_hint: e.target.value }))} />
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button className="btn btn-ghost" onClick={() => setSubmissionOpen(false)}>取消</button>
                  <button className="btn" onClick={submitNewBusiness} style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
                    <Send size={15} aria-hidden="true" /> 送出投稿
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
