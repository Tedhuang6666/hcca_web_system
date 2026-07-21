"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Check, Plus, RefreshCw, Save, ShieldCheck, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { recommendedVendorsApi, ApiError } from "@/lib/api";
import type {
  RecommendedVendorCreate,
  RecommendedVendorListItem,
  RecommendedVendorOut,
  RecommendedVendorProductOut,
  RecommendedVendorStatus,
} from "@/lib/types";

type VendorForm = {
  name: string; summary: string; description: string; category: string; address: string;
  latitude: string; longitude: string; google_maps_url: string; business_hours_text: string;
  contact_name: string; contact_phone: string; contact_email: string; line_id: string;
  social_url: string; website_url: string; ordering_instructions: string; menu_url: string;
  hygiene_inspection_date: string; hygiene_inspection_expires_at: string;
  hygiene_certificate_url: string; hygiene_note: string; status: RecommendedVendorStatus;
  sort_order: string; is_active: boolean; internal_note: string;
};

const emptyForm: VendorForm = {
  name: "", summary: "", description: "", category: "", address: "", latitude: "", longitude: "",
  google_maps_url: "", business_hours_text: "", contact_name: "", contact_phone: "", contact_email: "",
  line_id: "", social_url: "", website_url: "", ordering_instructions: "", menu_url: "",
  hygiene_inspection_date: "", hygiene_inspection_expires_at: "", hygiene_certificate_url: "",
  hygiene_note: "", status: "draft", sort_order: "0", is_active: true, internal_note: "",
};

function formFromVendor(vendor: RecommendedVendorOut): VendorForm {
  return {
    name: vendor.name, summary: vendor.summary || "", description: vendor.description || "", category: vendor.category || "",
    address: vendor.address || "", latitude: vendor.latitude?.toString() || "", longitude: vendor.longitude?.toString() || "",
    google_maps_url: vendor.google_maps_url || "", business_hours_text: vendor.business_hours_text || "",
    contact_name: vendor.contact_name || "", contact_phone: vendor.contact_phone || "", contact_email: vendor.contact_email || "",
    line_id: vendor.line_id || "", social_url: vendor.social_url || "", website_url: vendor.website_url || "",
    ordering_instructions: vendor.ordering_instructions || "", menu_url: vendor.menu_url || "",
    hygiene_inspection_date: vendor.hygiene_inspection_date || "", hygiene_inspection_expires_at: vendor.hygiene_inspection_expires_at || "",
    hygiene_certificate_url: vendor.hygiene_certificate_url || "", hygiene_note: vendor.hygiene_note || "",
    status: vendor.status as RecommendedVendorStatus, sort_order: vendor.sort_order.toString(), is_active: vendor.is_active,
    internal_note: vendor.internal_note || "",
  };
}

const emptyProduct = { name: "", description: "", price_text: "", menu_url: "" };

export default function RecommendedVendorsAdminPage() {
  const [vendors, setVendors] = useState<RecommendedVendorListItem[]>([]);
  const [selected, setSelected] = useState<RecommendedVendorOut | null>(null);
  const [form, setForm] = useState<VendorForm>(emptyForm);
  const [productForm, setProductForm] = useState(emptyProduct);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setVendors(await recommendedVendorsApi.adminList({ include_inactive: true })); }
    catch (error) { toast.error(error instanceof ApiError ? error.message : "載入管理資料失敗"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const select = async (id: string) => {
    try {
      const vendor = await recommendedVendorsApi.adminGet(id);
      setSelected(vendor); setForm(formFromVendor(vendor));
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "載入商家詳情失敗"); }
  };

  const update = <K extends keyof VendorForm>(key: K, value: VendorForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const payload = (): RecommendedVendorCreate => ({
    name: form.name.trim(), summary: form.summary.trim() || null, description: form.description.trim() || null,
    category: form.category.trim() || null, address: form.address.trim() || null,
    latitude: form.latitude ? Number(form.latitude) : null, longitude: form.longitude ? Number(form.longitude) : null,
    google_maps_url: form.google_maps_url.trim() || null, business_hours_text: form.business_hours_text.trim() || null,
    contact_name: form.contact_name.trim() || null, contact_phone: form.contact_phone.trim() || null,
    contact_email: form.contact_email.trim() || null, line_id: form.line_id.trim() || null,
    social_url: form.social_url.trim() || null, website_url: form.website_url.trim() || null,
    ordering_instructions: form.ordering_instructions.trim() || null, menu_url: form.menu_url.trim() || null,
    hygiene_inspection_date: form.hygiene_inspection_date || null,
    hygiene_inspection_expires_at: form.hygiene_inspection_expires_at || null,
    hygiene_certificate_url: form.hygiene_certificate_url.trim() || null, hygiene_note: form.hygiene_note.trim() || null,
    status: form.status, sort_order: Number(form.sort_order) || 0, is_active: form.is_active,
    internal_note: form.internal_note.trim() || null, products: [],
  });

  const save = async () => {
    if (!form.name.trim()) { toast.error("請輸入商家名稱"); return; }
    if (form.status === "active" && !form.hygiene_inspection_date) { toast.error("上架前請填寫衛生檢驗日期"); return; }
    setSaving(true);
    try {
      const vendor = selected ? await recommendedVendorsApi.update(selected.id, payload()) : await recommendedVendorsApi.create(payload());
      setSelected(vendor); setForm(formFromVendor(vendor)); await load(); toast.success(selected ? "已更新推薦商家" : "已建立推薦商家");
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "儲存失敗"); }
    finally { setSaving(false); }
  };

  const addProduct = async () => {
    if (!selected || !productForm.name.trim()) { toast.error("請先輸入品項名稱"); return; }
    try {
      const product = await recommendedVendorsApi.createProduct(selected.id, { ...productForm, name: productForm.name.trim() });
      const next = { ...selected, products: [...selected.products, product], product_count: selected.product_count + 1 };
      setSelected(next); setProductForm(emptyProduct); toast.success("已新增菜單／商品"); await load();
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "新增品項失敗"); }
  };

  const saveProduct = async (product: RecommendedVendorProductOut) => {
    try {
      const updated = await recommendedVendorsApi.updateProduct(product.id, product);
      if (selected) setSelected({ ...selected, products: selected.products.map((item) => item.id === updated.id ? updated : item) });
      toast.success("已更新品項");
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "更新品項失敗"); }
  };

  const removeProduct = async (product: RecommendedVendorProductOut) => {
    try { await recommendedVendorsApi.deleteProduct(product.id); if (selected) setSelected({ ...selected, products: selected.products.filter((item) => item.id !== product.id) }); toast.success("已刪除品項"); }
    catch (error) { toast.error(error instanceof ApiError ? error.message : "刪除品項失敗"); }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>推薦商家管理</h1><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>維護檢驗資料、聯絡方式、地圖連結與選填菜單。</p></div><div className="flex gap-2"><button type="button" className="btn btn-secondary" onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" />重新整理</button><button type="button" className="btn btn-primary" onClick={() => { setSelected(null); setForm(emptyForm); }}><Plus size={15} aria-hidden="true" />新增商家</button></div></header>
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-lg border" style={{ borderColor: "var(--border)" }}><div className="flex items-center gap-2 border-b p-4" style={{ borderColor: "var(--border)" }}><Store size={16} aria-hidden="true" /><span className="font-semibold" style={{ color: "var(--text-primary)" }}>商家清單</span></div><div className="max-h-[calc(100vh-250px)] overflow-y-auto p-2">{loading ? <p className="p-3 text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p> : vendors.map((vendor) => <button type="button" key={vendor.id} onClick={() => void select(vendor.id)} className="w-full rounded-md p-3 text-left hover:bg-[var(--bg-elevated)]" style={{ background: selected?.id === vendor.id ? "var(--primary-dim)" : "transparent" }}><p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{vendor.name}</p><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{vendor.status} · {vendor.hygiene_verified ? "檢驗有效" : "待補檢驗"}</p></button>)}</div></aside>
        <section className="space-y-5">
          <div className="rounded-lg border p-5" style={{ borderColor: "var(--border)" }}>
            <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>{selected ? `編輯：${selected.name}` : "建立推薦商家"}</h2><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>狀態設為「上架」且有檢驗日期後，才會出現在學生端。</p></div><ShieldCheck size={22} style={{ color: "#15803D" }} aria-hidden="true" /></div>
            <div className="grid gap-3 md:grid-cols-2">
              {(["name","category","summary","address","contact_name","contact_phone","contact_email","line_id","google_maps_url","menu_url","website_url","social_url","business_hours_text","hygiene_inspection_date","hygiene_inspection_expires_at","hygiene_certificate_url"] as const).map((key) => <label key={key} className="grid gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>{({ name: "商家名稱", category: "分類", summary: "簡介", address: "地址", contact_name: "聯絡人", contact_phone: "電話", contact_email: "Email", line_id: "LINE ID", google_maps_url: "Google Maps 連結", menu_url: "菜單連結", website_url: "官方網站", social_url: "社群連結", business_hours_text: "營業時間", hygiene_inspection_date: "衛生檢驗日期", hygiene_inspection_expires_at: "檢驗有效期限", hygiene_certificate_url: "檢驗證明連結" } as Record<string,string>)[key]}</span><input className="input" type={key.includes("date") ? "date" : key === "contact_email" ? "email" : key.endsWith("_url") ? "url" : "text"} value={form[key]} onChange={(event) => update(key, event.target.value)} /></label>)}
              <label className="grid gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>狀態</span><select className="input" value={form.status} onChange={(event) => update("status", event.target.value as RecommendedVendorStatus)}><option value="draft">草稿</option><option value="active">上架</option><option value="hidden">暫不上架</option><option value="archived">已封存</option></select></label>
              <label className="grid gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>排序</span><input className="input" type="number" value={form.sort_order} onChange={(event) => update("sort_order", event.target.value)} /></label>
              <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={form.is_active} onChange={(event) => update("is_active", event.target.checked)} />允許顯示</label>
              <label className="grid gap-1 text-sm md:col-span-2"><span style={{ color: "var(--text-secondary)" }}>介紹</span><textarea className="input min-h-24" value={form.description} onChange={(event) => update("description", event.target.value)} /></label>
              <label className="grid gap-1 text-sm md:col-span-2"><span style={{ color: "var(--text-secondary)" }}>訂購方式</span><textarea className="input min-h-20" value={form.ordering_instructions} onChange={(event) => update("ordering_instructions", event.target.value)} placeholder="例如：請先電話預訂，取餐時付款。" /></label>
              <label className="grid gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>緯度</span><input className="input" type="number" step="any" value={form.latitude} onChange={(event) => update("latitude", event.target.value)} /></label>
              <label className="grid gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>經度</span><input className="input" type="number" step="any" value={form.longitude} onChange={(event) => update("longitude", event.target.value)} /></label>
              <label className="grid gap-1 text-sm md:col-span-2"><span style={{ color: "var(--text-secondary)" }}>衛生檢驗備註</span><textarea className="input min-h-20" value={form.hygiene_note} onChange={(event) => update("hygiene_note", event.target.value)} /></label>
              <label className="grid gap-1 text-sm md:col-span-2"><span style={{ color: "var(--text-secondary)" }}>管理備註</span><textarea className="input min-h-20" value={form.internal_note} onChange={(event) => update("internal_note", event.target.value)} /></label>
            </div>
            <div className="mt-4 flex justify-end"><button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}><Save size={15} aria-hidden="true" />{saving ? "儲存中…" : "儲存商家"}</button></div>
          </div>
          {selected && <section className="rounded-lg border p-5" style={{ borderColor: "var(--border)" }}><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>菜單／商品資訊</h2><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>選填；沒有提供時，學生端會顯示尚未提供品項資訊。</p></div><button type="button" className="btn btn-secondary" onClick={() => void addProduct()}><Plus size={15} aria-hidden="true" />新增品項</button></div><div className="mt-4 grid gap-2 md:grid-cols-4"><input className="input" placeholder="品項名稱" value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} /><input className="input" placeholder="價格，例如 NT$60" value={productForm.price_text} onChange={(event) => setProductForm({ ...productForm, price_text: event.target.value })} /><input className="input md:col-span-2" placeholder="品項說明" value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} /></div><div className="mt-4 space-y-3">{selected.products.map((product) => <ProductRow key={product.id} product={product} onSave={saveProduct} onDelete={removeProduct} />)}</div></section>}
          {selected && selected.status !== "archived" && <div className="flex justify-end"><button type="button" className="btn btn-secondary" onClick={async () => { if (!confirm("確定封存這間推薦商家？")) return; await recommendedVendorsApi.archive(selected.id); setSelected(null); setForm(emptyForm); await load(); toast.success("已封存商家"); }}><Archive size={15} aria-hidden="true" />封存商家</button></div>}
        </section>
      </div>
    </main>
  );
}

function ProductRow({ product, onSave, onDelete }: { product: RecommendedVendorProductOut; onSave: (product: RecommendedVendorProductOut) => void; onDelete: (product: RecommendedVendorProductOut) => void }) {
  const [draft, setDraft] = useState(product);
  return <div className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_150px_1.5fr_auto]" style={{ borderColor: "var(--border)" }}><input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /><input className="input" value={draft.price_text || ""} onChange={(event) => setDraft({ ...draft, price_text: event.target.value })} /><input className="input" value={draft.description || ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /><div className="flex gap-2"><button type="button" className="btn btn-secondary" onClick={() => onSave(draft)} aria-label={`儲存 ${draft.name}`}><Check size={15} /></button><button type="button" className="btn btn-secondary" onClick={() => onDelete(draft)} aria-label={`刪除 ${draft.name}`}><Trash2 size={15} /></button></div></div>;
}
