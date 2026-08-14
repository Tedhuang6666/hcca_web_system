"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Store } from "lucide-react";
import { toast } from "sonner";
import { ApiError, partnerMapApi } from "@/lib/api";
import type { PartnerBusinessDetail, PartnerBusinessDirectoryItem } from "@/lib/api";
import type { BusinessHours, PartnerBusinessOutWithHours } from "@/lib/partner-map-types";
import BusinessHoursEditor from "../BusinessHoursEditor";

type ManagedBusiness = PartnerBusinessDetail & PartnerBusinessOutWithHours;

type BusinessForm = {
  name: string;
  summary: string;
  description: string;
  website_url: string;
  social_url: string;
  logo_url: string;
  cover_image_url: string;
  category: string;
  business_hours_text: string;
  business_hours: BusinessHours;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  instagram_handle: string;
  line_id: string;
  other_contact: string;
};

const emptyForm: BusinessForm = {
  name: "", summary: "", description: "", website_url: "", social_url: "", logo_url: "",
  cover_image_url: "", category: "", business_hours_text: "", business_hours: {},
  contact_name: "", contact_phone: "", contact_email: "", instagram_handle: "", line_id: "",
  other_contact: "",
};

function formFromBusiness(business: ManagedBusiness): BusinessForm {
  return {
    name: business.name,
    summary: business.summary || "",
    description: business.description || "",
    website_url: business.website_url || "",
    social_url: business.social_url || "",
    logo_url: business.logo_url || "",
    cover_image_url: business.cover_image_url || "",
    category: business.category || "",
    business_hours_text: business.business_hours_text || "",
    business_hours: business.business_hours || {},
    contact_name: business.contact_name || "",
    contact_phone: business.contact_phone || "",
    contact_email: business.contact_email || "",
    instagram_handle: business.instagram_handle || "",
    line_id: business.line_id || "",
    other_contact: business.other_contact || "",
  };
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="grid gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>{label} <span className="font-normal" style={{ color: "var(--text-muted)" }}>選填</span></span><input className="input" type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-sm md:col-span-2"><span style={{ color: "var(--text-secondary)" }}>{label} <span className="font-normal" style={{ color: "var(--text-muted)" }}>選填</span></span><textarea className="input min-h-24" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export default function MyBusinessesPage() {
  const [businesses, setBusinesses] = useState<PartnerBusinessDirectoryItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [business, setBusiness] = useState<ManagedBusiness | null>(null);
  const [form, setForm] = useState<BusinessForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    partnerMapApi.myBusinesses()
      .then((items) => {
        setBusinesses(items);
        if (items[0]) setSelectedId(items[0].id);
      })
      .catch((error) => toast.error(error instanceof ApiError ? error.message : "載入我的店家失敗"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setBusiness(null);
    partnerMapApi.getSelfBusiness(selectedId)
      .then((next) => {
        const managed = next as ManagedBusiness;
        setBusiness(managed);
        setForm(formFromBusiness(managed));
      })
      .catch((error) => toast.error(error instanceof ApiError ? error.message : "載入店家資料失敗"));
  }, [selectedId]);

  const setField = <K extends keyof BusinessForm>(key: K, value: BusinessForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!business || !form.name.trim()) {
      toast.error("店家名稱為必填");
      return;
    }
    setSaving(true);
    try {
      const updated = await partnerMapApi.updateSelfBusiness(business.id, {
        name: form.name.trim(),
        summary: form.summary.trim() || null,
        description: form.description.trim() || null,
        website_url: form.website_url.trim() || null,
        social_url: form.social_url.trim() || null,
        logo_url: form.logo_url.trim() || null,
        cover_image_url: form.cover_image_url.trim() || null,
        category: form.category.trim() || null,
        business_hours_text: form.business_hours_text.trim() || null,
        business_hours: form.business_hours,
        contact_name: form.contact_name.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        contact_email: form.contact_email.trim() || null,
        instagram_handle: form.instagram_handle.trim() || null,
        line_id: form.line_id.trim() || null,
        other_contact: form.other_contact.trim() || null,
      });
      const managed = updated as ManagedBusiness;
      setBusiness(managed);
      setForm(formFromBusiness(managed));
      toast.success("店家資料已更新");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "更新店家資料失敗");
    } finally {
      setSaving(false);
    }
  };

  const currentName = useMemo(() => business?.name || businesses.find((item) => item.id === selectedId)?.name || "我的店家", [business, businesses, selectedId]);

  return (
    <main className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><Link href="/partner-map" className="mb-2 inline-flex items-center gap-1 text-xs hover:underline" style={{ color: "var(--primary)" }}><ArrowLeft size={13} aria-hidden="true" />返回店家地圖</Link><h1 className="flex items-center gap-2 text-xl font-semibold" style={{ color: "var(--text-primary)" }}><Store size={20} aria-hidden="true" />我的店家</h1><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>你可以更新公開店務資料；上架狀態與優惠審核仍由平台管理員維護。</p></div>
        <button type="button" className="btn btn-primary" disabled={saving || !business} onClick={() => void save()}><Save size={15} aria-hidden="true" />{saving ? "儲存中…" : "儲存變更"}</button>
      </header>

      {loading ? <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p> : businesses.length === 0 ? (
        <section className="rounded-lg border border-dashed p-10 text-center" style={{ borderColor: "var(--border)" }}><Store className="mx-auto" size={28} style={{ color: "var(--text-muted)" }} /><p className="mt-3 text-sm font-medium" style={{ color: "var(--text-primary)" }}>目前沒有可管理的店家</p><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>若你應代表店家維護資料，請聯絡平台管理員設定帳號權限。</p></section>
      ) : (
        <>
          <label className="grid max-w-md gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>選擇店家</span><select className="input" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{businesses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <section className="rounded-lg border p-5" style={{ borderColor: "var(--border)" }}>
            <div className="mb-4"><h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{currentName}的公開資料</h2><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>修改後會立即送回平台，管理員保留審核與上架控制權。</p></div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="店家名稱" value={form.name} onChange={(value) => setField("name", value)} />
              <Field label="分類" value={form.category} onChange={(value) => setField("category", value)} />
              <Field label="聯絡人" value={form.contact_name} onChange={(value) => setField("contact_name", value)} />
              <Field label="聯絡電話" value={form.contact_phone} onChange={(value) => setField("contact_phone", value)} />
              <Field label="聯絡 Email" type="email" value={form.contact_email} onChange={(value) => setField("contact_email", value)} />
              <Field label="LINE ID" value={form.line_id} onChange={(value) => setField("line_id", value)} />
              <Field label="Instagram" value={form.instagram_handle} onChange={(value) => setField("instagram_handle", value)} />
              <Field label="官方網站" type="url" value={form.website_url} onChange={(value) => setField("website_url", value)} />
              <Field label="社群連結" type="url" value={form.social_url} onChange={(value) => setField("social_url", value)} />
              <Field label="營業時間說明" value={form.business_hours_text} onChange={(value) => setField("business_hours_text", value)} />
              <TextArea label="摘要" value={form.summary} onChange={(value) => setField("summary", value)} />
              <TextArea label="店家介紹" value={form.description} onChange={(value) => setField("description", value)} />
              <TextArea label="其他聯絡方式" value={form.other_contact} onChange={(value) => setField("other_contact", value)} />
              <BusinessHoursEditor value={form.business_hours} onChange={(value) => setField("business_hours", value)} />
            </div>
            <div className="mt-5 flex justify-end"><button type="button" className="btn btn-primary" disabled={saving || !business} onClick={() => void save()}><Save size={15} aria-hidden="true" />{saving ? "儲存中…" : "儲存變更"}</button></div>
          </section>
        </>
      )}
    </main>
  );
}
