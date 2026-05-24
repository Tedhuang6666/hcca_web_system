"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle, Plus, RefreshCw, Save, Store, Tag, Trash2, XCircle } from "lucide-react";
import { partnerMapApi, ApiError } from "@/lib/api";
import type {
  PartnerBusinessListItem,
  PartnerBusinessOut,
  PartnerBusinessStatus,
  PartnerSubmissionOut,
  PartnerTagOut,
} from "@/lib/types";

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
  status: "draft" as PartnerBusinessStatus,
  sort_order: 0,
  internal_note: "",
  tag_ids: [] as string[],
};

export default function PartnerMapAdminPage() {
  const [businesses, setBusinesses] = useState<PartnerBusinessListItem[]>([]);
  const [tags, setTags] = useState<PartnerTagOut[]>([]);
  const [tagDrafts, setTagDrafts] = useState<Record<string, { name: string; color: string; sort_order: number; is_active: boolean }>>({});
  const [submissions, setSubmissions] = useState<PartnerSubmissionOut[]>([]);
  const [selected, setSelected] = useState<PartnerBusinessOut | null>(null);
  const [businessForm, setBusinessForm] = useState(emptyBusiness);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#10B981");
  const [saving, setSaving] = useState(false);
  const [locationForm, setLocationForm] = useState({
    name: "",
    address: "",
    latitude: "",
    longitude: "",
    phone: "",
  });
  const [offerForm, setOfferForm] = useState({
    title: "",
    public_summary: "",
    full_description: "",
    instructions: "",
  });

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
          status: business.status,
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
  };

  const saveBusiness = async () => {
    if (!businessForm.name.trim()) {
      toast.error("請輸入店家名稱");
      return;
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
        internal_note: businessForm.internal_note || null,
      };
      const business = selected
        ? await partnerMapApi.updateBusiness(selected.id, payload)
        : await partnerMapApi.createBusiness(payload);
      toast.success(selected ? "已更新店家" : "已建立店家");
      setSelected(business);
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
      await partnerMapApi.createTag({ name: tagName.trim(), color: tagColor, is_active: true });
      setTagName("");
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
      });
      setLocationForm({ name: "", address: "", latitude: "", longitude: "", phone: "" });
      selectBusiness(selected.id);
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "新增點位失敗");
    }
  };

  const createOffer = async () => {
    if (!selected || !offerForm.title.trim()) return;
    try {
      await partnerMapApi.createOffer(selected.id, {
        title: offerForm.title,
        public_summary: offerForm.public_summary || null,
        full_description: offerForm.full_description || null,
        instructions: offerForm.instructions || null,
      });
      setOfferForm({ title: "", public_summary: "", full_description: "", instructions: "" });
      selectBusiness(selected.id);
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "新增優惠失敗");
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
          <button className="btn" onClick={resetCreate} style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
            <Plus size={15} aria-hidden="true" />新增店家
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
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
                      {business.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {business.location_count} 點位 · {business.active_offer_count} 有效優惠
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Tag size={16} aria-hidden="true" />
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>標籤</span>
            </div>
            <div className="flex gap-2">
              <input
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                className="input flex-1"
                placeholder="新增分類"
              />
              <input
                value={tagColor}
                onChange={(event) => setTagColor(event.target.value)}
                className="h-10 w-12 rounded border bg-transparent p-1"
                style={{ borderColor: "var(--border)" }}
                type="color"
                aria-label="分類顏色"
              />
              <button className="btn btn-ghost" onClick={createTag}><Plus size={15} aria-hidden="true" /></button>
            </div>
            <div className="mt-3 space-y-2">
              {tags.map((tag) => {
                const draft = tagDrafts[tag.id];
                if (!draft) return null;
                return (
                  <div key={tag.id} className="grid grid-cols-[1fr_44px_58px_32px_32px] items-center gap-2">
                    <input
                      className="input h-9"
                      value={draft.name}
                      onChange={(event) => setTagDrafts((current) => ({
                        ...current,
                        [tag.id]: { ...draft, name: event.target.value },
                      }))}
                    />
                    <input
                      className="h-9 rounded border bg-transparent p-1"
                      style={{ borderColor: "var(--border)" }}
                      type="color"
                      value={draft.color}
                      onChange={(event) => setTagDrafts((current) => ({
                        ...current,
                        [tag.id]: { ...draft, color: event.target.value },
                      }))}
                      aria-label={`${tag.name} 顏色`}
                    />
                    <input
                      className="input h-9"
                      type="number"
                      value={draft.sort_order}
                      onChange={(event) => setTagDrafts((current) => ({
                        ...current,
                        [tag.id]: { ...draft, sort_order: Number(event.target.value) },
                      }))}
                    />
                    <button
                      className="topbar-icon-btn"
                      onClick={() => setTagDrafts((current) => ({
                        ...current,
                        [tag.id]: { ...draft, is_active: !draft.is_active },
                      }))}
                      aria-label="切換啟用">
                      <span style={{ color: draft.is_active ? "var(--success)" : "var(--text-muted)" }}>●</span>
                    </button>
                    <button className="topbar-icon-btn" onClick={() => saveTag(tag.id)} aria-label="儲存分類">
                      <Save size={14} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
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
          <section className="card p-5">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>店家名稱</span>
                <input className="input" value={businessForm.name} onChange={(e) => setBusinessForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>狀態</span>
                <select className="input" value={businessForm.status} onChange={(e) => setBusinessForm((f) => ({ ...f, status: e.target.value as PartnerBusinessStatus }))}>
                  <option value="draft">draft</option>
                  <option value="active">active</option>
                  <option value="hidden">hidden</option>
                  <option value="archived">archived</option>
                </select>
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>摘要</span>
                <input className="input" value={businessForm.summary} onChange={(e) => setBusinessForm((f) => ({ ...f, summary: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>分類</span>
                <select className="input" value={businessForm.category} onChange={(e) => setBusinessForm((f) => ({ ...f, category: e.target.value }))}>
                  <option value="">未分類</option>
                  {tags.filter((tag) => tag.is_active).map((tag) => (
                    <option key={tag.id} value={tag.name}>{tag.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>營業時間</span>
                <input className="input" value={businessForm.business_hours_text} onChange={(e) => setBusinessForm((f) => ({ ...f, business_hours_text: e.target.value }))} />
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>描述</span>
                <textarea className="input min-h-24" value={businessForm.description} onChange={(e) => setBusinessForm((f) => ({ ...f, description: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>網站</span>
                <input className="input" value={businessForm.website_url} onChange={(e) => setBusinessForm((f) => ({ ...f, website_url: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>社群連結</span>
                <input className="input" value={businessForm.social_url} onChange={(e) => setBusinessForm((f) => ({ ...f, social_url: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Logo URL</span>
                <input className="input" value={businessForm.logo_url} onChange={(e) => setBusinessForm((f) => ({ ...f, logo_url: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>封面圖片 URL</span>
                <input className="input" value={businessForm.cover_image_url} onChange={(e) => setBusinessForm((f) => ({ ...f, cover_image_url: e.target.value }))} />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => {
                const active = businessForm.tag_ids.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className="rounded-full border px-3 py-1.5 text-xs"
                    style={{
                      borderColor: active ? "var(--primary)" : "var(--border)",
                      color: active ? "var(--primary)" : "var(--text-secondary)",
                    }}>
                    {tag.name}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <button className="btn" onClick={saveBusiness} disabled={saving} style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
                <Save size={15} aria-hidden="true" />{saving ? "儲存中..." : "儲存店家"}
              </button>
            </div>
          </section>

          {selected && (
            <div className="grid gap-4 xl:grid-cols-2">
              <section className="card p-5">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>點位</h2>
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
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <input className="input" placeholder="分店名稱" value={locationForm.name} onChange={(e) => setLocationForm((f) => ({ ...f, name: e.target.value }))} />
                  <input className="input" placeholder="電話" value={locationForm.phone} onChange={(e) => setLocationForm((f) => ({ ...f, phone: e.target.value }))} />
                  <input className="input sm:col-span-2" placeholder="地址" value={locationForm.address} onChange={(e) => setLocationForm((f) => ({ ...f, address: e.target.value }))} />
                  <input className="input" placeholder="緯度" value={locationForm.latitude} onChange={(e) => setLocationForm((f) => ({ ...f, latitude: e.target.value }))} />
                  <input className="input" placeholder="經度" value={locationForm.longitude} onChange={(e) => setLocationForm((f) => ({ ...f, longitude: e.target.value }))} />
                </div>
                <button className="btn btn-ghost mt-3" onClick={createLocation}><Plus size={15} aria-hidden="true" />新增點位</button>
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
                      <button className="topbar-icon-btn" onClick={() => partnerMapApi.deleteOffer(offer.id).then(() => selectBusiness(selected.id))} aria-label="刪除優惠">
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2">
                  <input className="input" placeholder="優惠標題" value={offerForm.title} onChange={(e) => setOfferForm((f) => ({ ...f, title: e.target.value }))} />
                  <input className="input" placeholder="公開摘要" value={offerForm.public_summary} onChange={(e) => setOfferForm((f) => ({ ...f, public_summary: e.target.value }))} />
                  <textarea className="input min-h-20" placeholder="完整優惠內容" value={offerForm.full_description} onChange={(e) => setOfferForm((f) => ({ ...f, full_description: e.target.value }))} />
                  <textarea className="input min-h-20" placeholder="使用方式" value={offerForm.instructions} onChange={(e) => setOfferForm((f) => ({ ...f, instructions: e.target.value }))} />
                </div>
                <button className="btn btn-ghost mt-3" onClick={createOffer}><Plus size={15} aria-hidden="true" />新增優惠</button>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
