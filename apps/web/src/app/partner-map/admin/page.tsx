"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle, MapPin, Pencil, Plus, RefreshCw, Save, Store, Tag, Trash2, XCircle } from "lucide-react";
import { partnerMapApi, ApiError } from "@/lib/api";
import type {
  PartnerBusinessDetail,
  PartnerBusinessDirectoryItem,
  PartnerBusinessListingType,
} from "@/lib/api";
import type {
  PartnerBusinessStatus,
  PartnerSubmissionOut,
  PartnerTagOut,
} from "@/lib/types";
import {
  defaultPartnerIconKey,
  getPartnerIcon,
  PARTNER_ICON_OPTIONS,
  type PartnerIconKey,
} from "../partner-map-icons";

const emptyBusiness = {
  name: "",
  summary: "",
  description: "",
  website_url: "",
  social_url: "",
  logo_url: "",
  cover_image_url: "",
  category: "",
  business_hours_text: "",
  listing_type: "physical" as PartnerBusinessListingType,
  contact_name: "",
  contact_phone: "",
  contact_email: "",
  instagram_handle: "",
  line_id: "",
  other_contact: "",
  status: "draft" as PartnerBusinessStatus,
  sort_order: 0,
  internal_note: "",
  tag_ids: [] as string[],
};

const statusLabels: Record<PartnerBusinessStatus, string> = {
  draft: "草稿",
  active: "公開",
  hidden: "暫時隱藏",
  archived: "封存",
};

type OfferDraft = {
  title: string;
  benefit_type: "discount" | "gift" | "bundle" | "member_price" | "other";
  benefit_value: string;
  public_summary: string;
  full_description: string;
  instructions: string;
};

type TagDraft = {
  name: string;
  color: string;
  icon_key: PartnerIconKey;
  sort_order: number;
  is_active: boolean;
};

const newOfferDraft = (): OfferDraft => ({
  title: "",
  benefit_type: "discount",
  benefit_value: "",
  public_summary: "",
  full_description: "",
  instructions: "",
});

const emptyLocation = () => ({
  name: "",
  address: "",
  latitude: "",
  longitude: "",
  phone: "",
  google_maps_url: "",
});

export default function PartnerMapAdminPage() {
  const [businesses, setBusinesses] = useState<PartnerBusinessDirectoryItem[]>([]);
  const [tags, setTags] = useState<PartnerTagOut[]>([]);
  const [tagDrafts, setTagDrafts] = useState<Record<string, TagDraft>>({});
  const [submissions, setSubmissions] = useState<PartnerSubmissionOut[]>([]);
  const [selected, setSelected] = useState<PartnerBusinessDetail | null>(null);
  const [businessForm, setBusinessForm] = useState(emptyBusiness);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#10B981");
  const [tagIconKey, setTagIconKey] = useState<PartnerIconKey>("store");
  const [saving, setSaving] = useState(false);
  const [parsingMap, setParsingMap] = useState(false);
  const [locationForm, setLocationForm] = useState(emptyLocation);
  const [offerForm, setOfferForm] = useState<OfferDraft>(newOfferDraft());
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [initialOfferForms, setInitialOfferForms] = useState<OfferDraft[]>([newOfferDraft()]);
  const [activeTab, setActiveTab] = useState<"businesses" | "tags">("businesses");

  const load = useCallback(() => {
    partnerMapApi
      .adminListBusinesses()
      .then(setBusinesses)
      .catch((error) => toast.error(error instanceof ApiError ? error.message : "載入店家失敗"));
    partnerMapApi.adminTags().then((items) => {
      setTags(items);
      setTagDrafts(Object.fromEntries(items.map((tag) => [
        tag.id,
        {
          name: tag.name,
          color: tag.color || "#10B981",
          icon_key: tag.icon_key && PARTNER_ICON_OPTIONS.some((option) => option.key === tag.icon_key)
            ? tag.icon_key as PartnerIconKey
            : defaultPartnerIconKey(tag.name),
          sort_order: tag.sort_order,
          is_active: tag.is_active,
        },
      ])));
    }).catch(() => {});
    partnerMapApi.adminSubmissions({ status: "pending" }).then(setSubmissions).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectBusiness = (id: string) => {
    setEditingOfferId(null);
    setOfferForm(newOfferDraft());
    partnerMapApi
      .adminGetBusiness(id)
      .then((business) => {
        setSelected(business);
        setBusinessForm({
          name: business.name,
          summary: business.summary || "",
          description: business.description || "",
          website_url: business.website_url || "",
          social_url: business.social_url || "",
          logo_url: business.logo_url || "",
          cover_image_url: business.cover_image_url || "",
          category: business.category || "",
          business_hours_text: business.business_hours_text || "",
          listing_type: business.listing_type as PartnerBusinessListingType,
          contact_name: business.contact_name || "",
          contact_phone: business.contact_phone || "",
          contact_email: business.contact_email || "",
          instagram_handle: business.instagram_handle || "",
          line_id: business.line_id || "",
          other_contact: business.other_contact || "",
          status: business.status as "draft" | "active" | "archived" | "hidden",
          sort_order: business.sort_order,
          internal_note: business.internal_note || "",
          tag_ids: business.tags.map((tag) => tag.id),
        });
      })
      .catch((error) => toast.error(error instanceof ApiError ? error.message : "載入詳情失敗"));
  };

  const resetCreate = () => {
    setSelected(null);
    setBusinessForm(emptyBusiness);
    setLocationForm(emptyLocation());
    setInitialOfferForms([newOfferDraft()]);
  };

  const updateInitialOffer = <K extends keyof OfferDraft>(index: number, key: K, value: OfferDraft[K]) => {
    setInitialOfferForms((offers) => offers.map((offer, offerIndex) => (
      offerIndex === index ? { ...offer, [key]: value } : offer
    )));
  };

  const saveBusiness = async () => {
    if (!businessForm.name.trim()) {
      toast.error("請輸入店家名稱");
      return;
    }
    const hasInitialLocationInput = [
      locationForm.google_maps_url,
      locationForm.address,
      locationForm.latitude,
      locationForm.longitude,
    ].some((value) => value.trim());
    const initialLatitude = Number(locationForm.latitude);
    const initialLongitude = Number(locationForm.longitude);
    if (!selected && businessForm.listing_type === "physical" && hasInitialLocationInput) {
      if (
        !locationForm.address.trim()
        || !locationForm.latitude.trim()
        || !locationForm.longitude.trim()
        || !Number.isFinite(initialLatitude)
        || !Number.isFinite(initialLongitude)
        || initialLatitude < -90
        || initialLatitude > 90
        || initialLongitude < -180
        || initialLongitude > 180
      ) {
        toast.error("請先完成地址與座標，或使用 Google Maps 自動擷取");
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        ...businessForm,
        summary: businessForm.summary || null,
        description: businessForm.description || null,
        website_url: businessForm.website_url || null,
        social_url: businessForm.social_url || null,
        logo_url: businessForm.logo_url || null,
        cover_image_url: businessForm.cover_image_url || null,
        category: businessForm.category || null,
        business_hours_text: businessForm.business_hours_text || null,
        contact_name: businessForm.contact_name || null,
        contact_phone: businessForm.contact_phone || null,
        contact_email: businessForm.contact_email || null,
        instagram_handle: businessForm.instagram_handle || null,
        line_id: businessForm.line_id || null,
        other_contact: businessForm.other_contact || null,
        internal_note: businessForm.internal_note || null,
        initial_offers: !selected ? initialOfferForms
          .filter((offer) => [offer.title, offer.benefit_value, offer.public_summary, offer.full_description, offer.instructions].some((value) => value.trim()))
          .map((offer, index) => ({
            title: offer.title.trim() || "學生特約優惠",
            benefit_type: offer.benefit_type,
            benefit_value: offer.benefit_value || null,
            public_summary: offer.public_summary || null,
            full_description: offer.full_description || null,
            instructions: offer.instructions || null,
            sort_order: index,
            is_active: true,
          })) : [],
        initial_locations: !selected && businessForm.listing_type === "physical" && hasInitialLocationInput ? [{
          name: locationForm.name || null,
          address: locationForm.address.trim(),
          latitude: initialLatitude,
          longitude: initialLongitude,
          phone: locationForm.phone || null,
          google_maps_url: locationForm.google_maps_url || null,
          sort_order: 0,
          is_active: true,
        }] : [],
      };
      const business = selected
        ? await partnerMapApi.updateBusiness(selected.id, payload)
        : await partnerMapApi.createBusiness(payload);
      const refreshedBusiness = await partnerMapApi.adminGetBusiness(business.id);
      toast.success(selected ? "已更新店家" : "已建立店家");
      setSelected(refreshedBusiness);
      if (!selected) {
        setOfferForm(newOfferDraft());
        setInitialOfferForms([newOfferDraft()]);
      }
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const createTag = async () => {
    if (!tagName.trim()) return;
    try {
      await partnerMapApi.createTag({ name: tagName.trim(), color: tagColor, icon_key: tagIconKey, sort_order: 0, is_active: true });
      setTagName("");
      setTagIconKey("store");
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "建立標籤失敗");
    }
  };

  const saveTag = async (tagId: string) => {
    const draft = tagDrafts[tagId];
    if (!draft?.name.trim()) return;
    try {
      await partnerMapApi.updateTag(tagId, {
        name: draft.name.trim(),
        color: draft.color || null,
        icon_key: draft.icon_key,
        sort_order: draft.sort_order,
        is_active: draft.is_active,
      });
      toast.success("已更新分類");
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "更新分類失敗");
    }
  };

  const reviewSubmission = async (id: string, approved: boolean) => {
    try {
      await partnerMapApi.reviewSubmission(id, {
        status: approved ? "approved" : "rejected",
        review_note: approved ? "已由管理員採納" : "暫不採納",
      });
      toast.success(approved ? "已採納投稿" : "已退回投稿");
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "審核投稿失敗");
    }
  };

  const createLocation = async () => {
    if (!selected) return;
    const latitude = Number(locationForm.latitude);
    const longitude = Number(locationForm.longitude);
    if (!locationForm.address.trim() || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      toast.error("請輸入地址與有效座標");
      return;
    }
    try {
      await partnerMapApi.createLocation(selected.id, {
        name: locationForm.name || null,
        address: locationForm.address,
        latitude,
        longitude,
        phone: locationForm.phone || null,
        google_maps_url: locationForm.google_maps_url || null,
        sort_order: 0,
        is_active: true,
      });
      setLocationForm(emptyLocation());
      selectBusiness(selected.id);
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "新增點位失敗");
    }
  };

  const parseGoogleMaps = async () => {
    if (!locationForm.google_maps_url.trim()) {
      toast.error("請先貼上 Google Maps 連結");
      return;
    }
    setParsingMap(true);
    try {
      const location = await partnerMapApi.parseGoogleMaps(locationForm.google_maps_url);
      setLocationForm((form) => ({
        ...form,
        google_maps_url: location.google_maps_url,
        name: location.name || form.name,
        address: location.address ?? form.address,
        latitude: String(location.latitude),
        longitude: String(location.longitude),
      }));
      if (!selected && location.name) {
        setBusinessForm((form) => (form.name.trim() ? form : { ...form, name: location.name || "" }));
      }
      toast.success(
        location.address
          ? "已帶入店家名稱、地址與座標，請確認後儲存"
          : "已帶入店家名稱與座標；地址請手動確認後儲存",
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "無法解析 Google Maps 連結");
    } finally {
      setParsingMap(false);
    }
  };

  const editOffer = (offer: PartnerBusinessDetail["offers"][number]) => {
    setEditingOfferId(offer.id);
    setOfferForm({
      title: offer.title,
      benefit_type: offer.benefit_type,
      benefit_value: offer.benefit_value || "",
      public_summary: offer.public_summary || "",
      full_description: offer.full_description || "",
      instructions: offer.instructions || "",
    });
  };

  const saveOffer = async () => {
    if (!selected || !offerForm.title.trim()) return;
    try {
      const payload = {
        title: offerForm.title.trim(),
        benefit_type: offerForm.benefit_type,
        benefit_value: offerForm.benefit_value.trim() || null,
        public_summary: offerForm.public_summary.trim() || null,
        full_description: offerForm.full_description.trim() || null,
        instructions: offerForm.instructions.trim() || null,
      };
      if (editingOfferId) {
        await partnerMapApi.updateOffer(editingOfferId, payload);
      } else {
        await partnerMapApi.createOffer(selected.id, { ...payload, sort_order: 0, is_active: true });
      }
      setOfferForm(newOfferDraft());
      setEditingOfferId(null);
      selectBusiness(selected.id);
      load();
      toast.success(editingOfferId ? "已更新優惠" : "已新增優惠");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : editingOfferId ? "更新優惠失敗" : "新增優惠失敗");
    }
  };

  const toggleTag = (id: string) => {
    setBusinessForm((form) => ({
      ...form,
      tag_ids: form.tag_ids.includes(id)
        ? form.tag_ids.filter((tagId) => tagId !== id)
        : [...form.tag_ids, id],
    }));
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>特約管理</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>維護店家、標籤、地圖點位與優惠內容</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={load}><RefreshCw size={15} aria-hidden="true" />重新整理</button>
          <button className="btn" onClick={() => { resetCreate(); setActiveTab("businesses"); }} style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
            <Plus size={15} aria-hidden="true" />新增店家
          </button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="特約管理分頁" style={{ borderColor: "var(--border)" }}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "businesses"}
          aria-controls="businesses-panel"
          onClick={() => setActiveTab("businesses")}
          className="flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors"
          style={{
            borderColor: activeTab === "businesses" ? "var(--primary)" : "transparent",
            color: activeTab === "businesses" ? "var(--primary)" : "var(--text-muted)",
          }}>
          <Store size={16} aria-hidden="true" />店家管理
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "tags"}
          aria-controls="tags-panel"
          onClick={() => setActiveTab("tags")}
          className="flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors"
          style={{
            borderColor: activeTab === "tags" ? "var(--primary)" : "transparent",
            color: activeTab === "tags" ? "var(--primary)" : "var(--text-muted)",
          }}>
          <Tag size={16} aria-hidden="true" />標籤管理
        </button>
      </div>

      {activeTab === "businesses" ? <div id="businesses-panel" role="tabpanel" aria-label="店家管理" className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <Store size={16} aria-hidden="true" />
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>店家</span>
            </div>
            <div className="max-h-[560px] overflow-y-auto p-2">
              {businesses.map((business) => (
                <button
                  key={business.id}
                  onClick={() => selectBusiness(business.id)}
                  className="w-full rounded-lg p-3 text-left"
                  style={{
                    background: selected?.id === business.id ? "var(--primary-dim)" : "transparent",
                    color: "var(--text-primary)",
                  }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{business.name}</span>
                    <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                    {statusLabels[business.status as PartnerBusinessStatus] ?? business.status}
                  </span>
                </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {business.listing_type === "online" ? "線上合作" : `${business.location_count} 個實體據點`} · {business.active_offer_count} 個優惠
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Store size={16} aria-hidden="true" />
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>待審投稿</span>
            </div>
            <div className="space-y-2">
              {submissions.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>目前沒有待審店家</p>
              ) : submissions.map((submission) => (
                <div key={submission.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{submission.name}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {[submission.category, submission.address].filter(Boolean).join(" · ") || "未提供分類或地址"}
                  </p>
                  {submission.offer_hint && (
                    <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{submission.offer_hint}</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button className="btn btn-ghost" onClick={() => reviewSubmission(submission.id, true)}>
                      <CheckCircle size={14} aria-hidden="true" />採納
                    </button>
                    <button className="btn btn-ghost" onClick={() => reviewSubmission(submission.id, false)}>
                      <XCircle size={14} aria-hidden="true" />退回
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="space-y-4">
          <section className="card overflow-hidden">
            <div className="border-b p-5" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs font-medium" style={{ color: "var(--primary)" }}>{selected ? "編輯合作夥伴" : "建立合作夥伴"}</p>
              <h2 className="mt-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{businessForm.name || "尚未命名的合作夥伴"}</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>先完成基本資料，再補充公開聯絡方式、位置與優惠。</p>
            </div>
            <div className="space-y-7 p-5">
              <section>
                <div className="mb-3"><h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>基本資料</h3><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>學生端列表會優先顯示名稱、摘要與合作型態。</p></div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>店家名稱</span><input className="input" value={businessForm.name} onChange={(e) => setBusinessForm((f) => ({ ...f, name: e.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>合作型態</span><select className="input" value={businessForm.listing_type} onChange={(e) => setBusinessForm((f) => ({ ...f, listing_type: e.target.value as PartnerBusinessListingType }))}><option value="physical">實體店家（顯示據點）</option><option value="online">線上合作（不顯示位置）</option></select></label>
                  <label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>狀態</span><select className="input" value={businessForm.status} onChange={(e) => setBusinessForm((f) => ({ ...f, status: e.target.value as PartnerBusinessStatus }))}><option value="draft">草稿</option><option value="active">公開</option><option value="hidden">暫時隱藏</option><option value="archived">封存</option></select></label>
                  <label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>分類</span><select className="input" value={businessForm.category} onChange={(e) => setBusinessForm((f) => ({ ...f, category: e.target.value }))}><option value="">未分類</option>{tags.filter((tag) => tag.is_active).map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}</select></label>
                  <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>摘要</span><input className="input" value={businessForm.summary} onChange={(e) => setBusinessForm((f) => ({ ...f, summary: e.target.value }))} placeholder="一句話說明合作內容" /></label>
                  <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>合作介紹</span><textarea className="input min-h-24" value={businessForm.description} onChange={(e) => setBusinessForm((f) => ({ ...f, description: e.target.value }))} placeholder="補充學生需要知道的合作背景或服務內容" /></label>
                </div>
              </section>

              <section className="border-t pt-6" style={{ borderColor: "var(--border)" }}>
                <div className="mb-3"><h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>公開聯絡方式</h3><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>至少填一種學生可以使用的聯絡或前往方式。</p></div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>聯絡人</span><input className="input" value={businessForm.contact_name} onChange={(e) => setBusinessForm((f) => ({ ...f, contact_name: e.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>聯絡電話</span><input className="input" value={businessForm.contact_phone} onChange={(e) => setBusinessForm((f) => ({ ...f, contact_phone: e.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>聯絡 Email</span><input className="input" type="email" value={businessForm.contact_email} onChange={(e) => setBusinessForm((f) => ({ ...f, contact_email: e.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Instagram 帳號</span><input className="input" placeholder="例如 hcca_store（可含 @）" value={businessForm.instagram_handle} onChange={(e) => setBusinessForm((f) => ({ ...f, instagram_handle: e.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>LINE ID</span><input className="input" value={businessForm.line_id} onChange={(e) => setBusinessForm((f) => ({ ...f, line_id: e.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>網站／合作頁</span><input className="input" type="url" value={businessForm.website_url} onChange={(e) => setBusinessForm((f) => ({ ...f, website_url: e.target.value }))} /></label>
                  <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>其他聯絡方式</span><textarea className="input min-h-20" placeholder="可自訂輸入 Discord、表單連結或其他說明" value={businessForm.other_contact} onChange={(e) => setBusinessForm((f) => ({ ...f, other_contact: e.target.value }))} /></label>
                </div>
              </section>

              <section className="border-t pt-6" style={{ borderColor: "var(--border)" }}>
                <div className="mb-3"><h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>顯示素材與分類</h3><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>選填，讓學生更容易辨識合作夥伴。</p></div>
                <div className="grid gap-3 md:grid-cols-2"><label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>社群連結</span><input className="input" type="url" value={businessForm.social_url} onChange={(e) => setBusinessForm((f) => ({ ...f, social_url: e.target.value }))} /></label><label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>營業時間</span><input className="input" value={businessForm.business_hours_text} onChange={(e) => setBusinessForm((f) => ({ ...f, business_hours_text: e.target.value }))} /></label><label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Logo URL</span><input className="input" value={businessForm.logo_url} onChange={(e) => setBusinessForm((f) => ({ ...f, logo_url: e.target.value }))} /></label><label className="space-y-1"><span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>封面圖片 URL</span><input className="input" value={businessForm.cover_image_url} onChange={(e) => setBusinessForm((f) => ({ ...f, cover_image_url: e.target.value }))} /></label></div>
                <div className="mt-4 flex flex-wrap gap-2">{tags.map((tag) => { const active = businessForm.tag_ids.includes(tag.id); return <button type="button" key={tag.id} onClick={() => toggleTag(tag.id)} className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: active ? "var(--primary)" : "var(--border)", color: active ? "var(--primary)" : "var(--text-secondary)", background: active ? "var(--primary-dim)" : "transparent" }}>{tag.name}</button>; })}</div>
              </section>
            {!selected && businessForm.listing_type === "physical" && (
              <section className="border-t pt-6" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>實體店家位置（可選）</h3>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      先貼 Google Maps 連結自動帶入資料，再手動修改或補充；之後仍可新增多個分店。
                    </p>
                  </div>
                  <MapPin size={18} style={{ color: "var(--primary)" }} aria-hidden="true" />
                </div>
                <div className="mt-4 rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
                  <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Google Maps 連結</label>
                  <div className="mt-2 flex gap-2">
                    <input
                      className="input min-w-0 flex-1"
                      type="url"
                      placeholder="貼上 Google Maps 分享連結"
                      value={locationForm.google_maps_url}
                      onChange={(e) => setLocationForm((f) => ({ ...f, google_maps_url: e.target.value }))}
                    />
                    <button type="button" className="btn btn-secondary shrink-0" onClick={() => void parseGoogleMaps()} disabled={parsingMap}>
                      {parsingMap ? "解析中…" : "自動擷取"}
                    </button>
                  </div>
                  <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>可自動帶入店家名稱與座標；地址依連結內容提供，欄位都可以再修改。</p>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>分店名稱</span><input className="input" placeholder="例如：竹北店" value={locationForm.name} onChange={(e) => setLocationForm((f) => ({ ...f, name: e.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>據點電話</span><input className="input" placeholder="選填" value={locationForm.phone} onChange={(e) => setLocationForm((f) => ({ ...f, phone: e.target.value }))} /></label>
                  <label className="space-y-1 sm:col-span-2"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>地址</span><input className="input" placeholder="請確認或手動輸入完整地址" value={locationForm.address} onChange={(e) => setLocationForm((f) => ({ ...f, address: e.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>緯度</span><input className="input" inputMode="decimal" placeholder="例如：24.8440999" value={locationForm.latitude} onChange={(e) => setLocationForm((f) => ({ ...f, latitude: e.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>經度</span><input className="input" inputMode="decimal" placeholder="例如：121.0220416" value={locationForm.longitude} onChange={(e) => setLocationForm((f) => ({ ...f, longitude: e.target.value }))} /></label>
                </div>
              </section>
            )}
            {!selected && <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>建立時加入優惠（可多筆）</h2><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>可一次建立多個優惠；完整條款會直接顯示給所有訪客。</p></div>
                <button type="button" className="btn btn-ghost" onClick={() => setInitialOfferForms((offers) => [...offers, newOfferDraft()])}><Plus size={15} aria-hidden="true" />新增優惠</button>
              </div>
              <div className="mt-3 space-y-3">
                {initialOfferForms.map((offer, index) => <div key={index} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                  <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>優惠 {index + 1}</span>{initialOfferForms.length > 1 && <button type="button" className="topbar-icon-btn" onClick={() => setInitialOfferForms((offers) => offers.filter((_, offerIndex) => offerIndex !== index))} aria-label={`移除優惠 ${index + 1}`}><Trash2 size={14} /></button>}</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>優惠標題</span><input className="input" placeholder="例如：學生證折扣" value={offer.title} onChange={(e) => updateInitialOffer(index, "title", e.target.value)} /></label>
                    <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>優惠重點</span><input className="input" placeholder="例如：全館 9 折" value={offer.benefit_value} onChange={(e) => updateInitialOffer(index, "benefit_value", e.target.value)} /></label>
                    <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>優惠類型</span><select className="input" value={offer.benefit_type} onChange={(e) => updateInitialOffer(index, "benefit_type", e.target.value as OfferDraft["benefit_type"])}><option value="discount">折扣</option><option value="gift">贈品</option><option value="bundle">組合優惠</option><option value="member_price">學生價</option><option value="other">其他合作優惠</option></select></label>
                    <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>公開摘要</span><input className="input" placeholder="例如：出示學生證享 9 折" value={offer.public_summary} onChange={(e) => updateInitialOffer(index, "public_summary", e.target.value)} /></label>
                    <label className="space-y-1 md:col-span-2"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>完整優惠條款</span><textarea className="input min-h-20" placeholder="例如：全品項 9 折，部分商品除外" value={offer.full_description} onChange={(e) => updateInitialOffer(index, "full_description", e.target.value)} /></label>
                    <label className="space-y-1 md:col-span-2"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>使用方式</span><textarea className="input min-h-20" placeholder="例如：聯絡時出示學生證或輸入優惠碼" value={offer.instructions} onChange={(e) => updateInitialOffer(index, "instructions", e.target.value)} /></label>
                  </div>
                </div>)}
              </div>
            </div>}
            <div className="mt-4 flex justify-end">
              <button className="btn" onClick={saveBusiness} disabled={saving} style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
                <Save size={15} aria-hidden="true" />{saving ? "儲存中..." : "儲存店家"}
              </button>
            </div>
            </div>
          </section>

          {selected && (
            <div className="grid gap-4 xl:grid-cols-2">
              <section className="card p-5">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{selected.listing_type === "online" ? "線上合作設定" : "實體據點"}</h2>
                {selected.listing_type === "online" ? (
                  <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>線上合作不會對學生顯示位置。請在上方補齊網站、Instagram、LINE 或其他聯絡方式。</p>
                ) : (
                  <>
                    <div className="mt-3 space-y-2">
                      {selected.locations.map((location) => (
                    <div key={location.id} className="flex items-start justify-between gap-3 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{location.name || selected.name}</p>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{location.address}</p>
                      </div>
                      <button className="topbar-icon-btn" onClick={() => partnerMapApi.deleteLocation(location.id).then(() => selectBusiness(selected.id))} aria-label="刪除點位">
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                      ))}
                    </div>
                    <div className="mt-4 rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
                      <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Google Maps 連結</label>
                      <div className="mt-2 flex gap-2">
                        <input className="input min-w-0 flex-1" type="url" placeholder="貼上連結，自動帶入可辨識資料" value={locationForm.google_maps_url} onChange={(e) => setLocationForm((f) => ({ ...f, google_maps_url: e.target.value }))} />
                        <button type="button" className="btn btn-secondary shrink-0" onClick={() => void parseGoogleMaps()} disabled={parsingMap}>{parsingMap ? "解析中…" : "自動擷取"}</button>
                      </div>
                      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>擷取後仍可手動修改名稱、地址與座標。</p>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>分店名稱</span><input className="input" placeholder="例如：竹北店" value={locationForm.name} onChange={(e) => setLocationForm((f) => ({ ...f, name: e.target.value }))} /></label>
                      <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>電話</span><input className="input" placeholder="選填" value={locationForm.phone} onChange={(e) => setLocationForm((f) => ({ ...f, phone: e.target.value }))} /></label>
                      <label className="space-y-1 sm:col-span-2"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>地址</span><input className="input" placeholder="請確認或手動輸入完整地址" value={locationForm.address} onChange={(e) => setLocationForm((f) => ({ ...f, address: e.target.value }))} /></label>
                      <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>緯度</span><input className="input" placeholder="緯度" value={locationForm.latitude} onChange={(e) => setLocationForm((f) => ({ ...f, latitude: e.target.value }))} /></label>
                      <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>經度</span><input className="input" placeholder="經度" value={locationForm.longitude} onChange={(e) => setLocationForm((f) => ({ ...f, longitude: e.target.value }))} /></label>
                    </div>
                    <button className="btn btn-ghost mt-3" onClick={createLocation}><Plus size={15} aria-hidden="true" />新增點位</button>
                  </>
                )}
              </section>

              <section className="card p-5">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>優惠</h2>
                <div className="mt-3 space-y-2">
                  {selected.offers.map((offer) => (
                    <div key={offer.id} className="flex items-start justify-between gap-3 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{offer.title}</p>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{offer.public_summary || "無摘要"}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button className="topbar-icon-btn" onClick={() => editOffer(offer)} aria-label={`編輯優惠 ${offer.title}`}>
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                        <button className="topbar-icon-btn" onClick={() => partnerMapApi.deleteOffer(offer.id).then(() => selectBusiness(selected.id))} aria-label="刪除優惠">
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2">
                  <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>優惠標題</span><input className="input" placeholder="例如：學生證折扣" value={offerForm.title} onChange={(e) => setOfferForm((f) => ({ ...f, title: e.target.value }))} /></label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>優惠類型</span><select className="input" value={offerForm.benefit_type} onChange={(e) => setOfferForm((f) => ({ ...f, benefit_type: e.target.value as typeof f.benefit_type }))}>
                      <option value="discount">折扣</option><option value="gift">贈品</option><option value="bundle">組合優惠</option><option value="member_price">學生價</option><option value="other">其他合作優惠</option>
                    </select></label>
                    <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>優惠重點</span><input className="input" placeholder="例如：全品項 9 折" value={offerForm.benefit_value} onChange={(e) => setOfferForm((f) => ({ ...f, benefit_value: e.target.value }))} /></label>
                  </div>
                  <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>公開摘要</span><input className="input" placeholder="例如：出示學生證享 9 折" value={offerForm.public_summary} onChange={(e) => setOfferForm((f) => ({ ...f, public_summary: e.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>完整優惠條款</span><textarea className="input min-h-20" placeholder="例如：全品項 9 折，部分商品除外" value={offerForm.full_description} onChange={(e) => setOfferForm((f) => ({ ...f, full_description: e.target.value }))} /></label>
                  <label className="space-y-1"><span className="text-xs" style={{ color: "var(--text-secondary)" }}>使用方式</span><textarea className="input min-h-20" placeholder="例如：聯絡時出示學生證或輸入優惠碼" value={offerForm.instructions} onChange={(e) => setOfferForm((f) => ({ ...f, instructions: e.target.value }))} /></label>
                </div>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-ghost" onClick={saveOffer}>
                    {editingOfferId ? <Save size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
                    {editingOfferId ? "儲存優惠" : "新增優惠"}
                  </button>
                  {editingOfferId && <button className="btn btn-secondary" onClick={() => { setEditingOfferId(null); setOfferForm(newOfferDraft()); }}>取消編輯</button>}
                </div>
              </section>
            </div>
          )}
        </main>
      </div> : (
        <section id="tags-panel" role="tabpanel" aria-label="標籤管理" className="card p-5">
          <div className="mb-5 flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ color: "var(--primary)", background: "var(--primary-dim)" }}>
              <Tag size={18} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>標籤管理</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>設定店家分類的名稱、顏色與圖示，讓地圖上的店家更容易辨識。</p>
            </div>
          </div>
          <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_96px_minmax(180px,0.8fr)_auto]" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
            <label className="grid min-w-0 gap-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>分類名稱</span>
              <input value={tagName} onChange={(event) => setTagName(event.target.value)} className="input h-9" placeholder="例如：制服、飲料、文具" />
            </label>
            <label className="grid min-w-0 gap-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>顏色</span>
              <input value={tagColor} onChange={(event) => setTagColor(event.target.value)} className="h-9 w-full rounded border bg-transparent p-1" style={{ borderColor: "var(--border)" }} type="color" aria-label="分類顏色" />
            </label>
            <label className="grid min-w-0 gap-1">
              <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>圖示</span>
              <select className="input h-9" value={tagIconKey} onChange={(event) => setTagIconKey(event.target.value as PartnerIconKey)}>
                {PARTNER_ICON_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </label>
            <button className="btn btn-ghost w-full self-end md:w-auto" onClick={createTag} aria-label="新增標籤">
              <Plus size={15} aria-hidden="true" /> 新增
            </button>
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            每個標籤可以設定自己的顏色與圖示，店家套用標籤後會同步顯示在地圖點位上。
          </p>
          <div className="mt-4 space-y-3">
            {tags.map((tag) => {
              const draft = tagDrafts[tag.id];
              if (!draft) return null;
              const Icon = getPartnerIcon(draft.icon_key);
              return (
                <div key={tag.id} className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md" style={{ color: draft.color, background: `${draft.color}22` }}>
                        <Icon size={17} aria-hidden="true" />
                      </span>
                      <span className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{draft.name || "未命名標籤"}</span>
                    </div>
                    <button className="btn btn-ghost h-8 px-2 text-xs" onClick={() => saveTag(tag.id)}>
                      <Save size={14} aria-hidden="true" /> 儲存
                    </button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_96px_minmax(180px,1.3fr)_80px_96px]">
                    <label className="grid min-w-0 gap-1">
                      <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>標籤名稱</span>
                      <input className="input h-9" value={draft.name} onChange={(event) => setTagDrafts((current) => ({ ...current, [tag.id]: { ...draft, name: event.target.value } }))} />
                    </label>
                    <label className="grid min-w-0 gap-1">
                      <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>顏色</span>
                      <input className="h-9 w-full rounded border bg-transparent p-1" style={{ borderColor: "var(--border)" }} type="color" value={draft.color} onChange={(event) => setTagDrafts((current) => ({ ...current, [tag.id]: { ...draft, color: event.target.value } }))} aria-label={`${tag.name} 顏色`} />
                    </label>
                    <label className="grid min-w-0 gap-1">
                      <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>圖示</span>
                      <select className="input h-9" value={draft.icon_key} onChange={(event) => setTagDrafts((current) => ({ ...current, [tag.id]: { ...draft, icon_key: event.target.value as PartnerIconKey } }))} aria-label={`${tag.name} 圖示`}>
                        {PARTNER_ICON_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="grid min-w-0 gap-1">
                      <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>排序</span>
                      <input className="input h-9" type="number" value={draft.sort_order} onChange={(event) => setTagDrafts((current) => ({ ...current, [tag.id]: { ...draft, sort_order: Number(event.target.value) } }))} />
                    </label>
                    <label className="grid min-w-0 gap-1">
                      <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>狀態</span>
                      <button className="btn btn-ghost h-9 justify-start px-2 text-xs" onClick={() => setTagDrafts((current) => ({ ...current, [tag.id]: { ...draft, is_active: !draft.is_active } }))} aria-label="切換啟用">
                        <span className="h-2 w-2 rounded-full" style={{ background: draft.is_active ? "var(--success)" : "var(--text-muted)" }} />
                        {draft.is_active ? "啟用中" : "已停用"}
                      </button>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
