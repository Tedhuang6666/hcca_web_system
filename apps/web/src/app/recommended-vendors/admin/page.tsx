"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Archive, Check, ExternalLink, FileText, Image as ImageIcon, Plus, RefreshCw, Save,
  ShieldCheck, Store, Trash2, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { recommendedVendorsApi, ApiError } from "@/lib/api";
import { apiUrl } from "@/lib/config";
import type {
  RecommendedVendorCategoryOut, RecommendedVendorCreate, RecommendedVendorListItem,
  RecommendedVendorMenuOut, RecommendedVendorOut, RecommendedVendorProductOut,
  RecommendedVendorStatus,
} from "@/lib/types";

type VendorForm = {
  name: string; summary: string; description: string; category_id: string; address: string;
  latitude: string; longitude: string; google_maps_url: string; business_hours_text: string;
  contact_name: string; contact_phone: string; contact_email: string; line_id: string;
  social_url: string; website_url: string; ordering_instructions: string; menu_url: string;
  hygiene_inspection_date: string; hygiene_inspection_expires_at: string;
  hygiene_certificate_url: string; hygiene_note: string; status: RecommendedVendorStatus;
  sort_order: string; is_active: boolean; internal_note: string;
};

const emptyForm: VendorForm = {
  name: "", summary: "", description: "", category_id: "", address: "", latitude: "", longitude: "",
  google_maps_url: "", business_hours_text: "", contact_name: "", contact_phone: "", contact_email: "",
  line_id: "", social_url: "", website_url: "", ordering_instructions: "", menu_url: "",
  hygiene_inspection_date: "", hygiene_inspection_expires_at: "", hygiene_certificate_url: "",
  hygiene_note: "", status: "draft", sort_order: "0", is_active: true, internal_note: "",
};

const emptyProduct = { name: "", description: "", price_text: "" };

function formFromVendor(vendor: RecommendedVendorOut): VendorForm {
  return {
    name: vendor.name, summary: vendor.summary || "", description: vendor.description || "",
    category_id: vendor.category_id || "", address: vendor.address || "",
    latitude: vendor.latitude?.toString() || "", longitude: vendor.longitude?.toString() || "",
    google_maps_url: vendor.google_maps_url || "", business_hours_text: vendor.business_hours_text || "",
    contact_name: vendor.contact_name || "", contact_phone: vendor.contact_phone || "",
    contact_email: vendor.contact_email || "", line_id: vendor.line_id || "", social_url: vendor.social_url || "",
    website_url: vendor.website_url || "", ordering_instructions: vendor.ordering_instructions || "",
    menu_url: vendor.menu_url || "", hygiene_inspection_date: vendor.hygiene_inspection_date || "",
    hygiene_inspection_expires_at: vendor.hygiene_inspection_expires_at || "",
    hygiene_certificate_url: vendor.hygiene_certificate_url || "", hygiene_note: vendor.hygiene_note || "",
    status: vendor.status as RecommendedVendorStatus, sort_order: String(vendor.sort_order),
    is_active: vendor.is_active, internal_note: vendor.internal_note || "",
  };
}

export default function RecommendedVendorsAdminPage() {
  const [vendors, setVendors] = useState<RecommendedVendorListItem[]>([]);
  const [categories, setCategories] = useState<RecommendedVendorCategoryOut[]>([]);
  const [selected, setSelected] = useState<RecommendedVendorOut | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [productForm, setProductForm] = useState(emptyProduct);
  const [menuTitle, setMenuTitle] = useState("");
  const [menuUrl, setMenuUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vendorRows, categoryRows] = await Promise.all([
        recommendedVendorsApi.adminList({ include_inactive: true }),
        recommendedVendorsApi.listCategoriesAdmin(),
      ]);
      setVendors(vendorRows);
      setCategories(categoryRows);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "載入管理資料失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = <K extends keyof VendorForm>(key: K, value: VendorForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const selectVendor = async (id: string) => {
    try {
      const vendor = await recommendedVendorsApi.adminGet(id);
      setSelected(vendor);
      setForm(formFromVendor(vendor));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "載入商家詳情失敗");
    }
  };

  const payload = (): RecommendedVendorCreate => ({
    name: form.name.trim(), summary: form.summary.trim() || null, description: form.description.trim() || null,
    category_id: form.category_id || null, address: form.address.trim() || null,
    latitude: form.latitude ? Number(form.latitude) : null, longitude: form.longitude ? Number(form.longitude) : null,
    google_maps_url: form.google_maps_url.trim() || null, business_hours_text: form.business_hours_text.trim() || null,
    contact_name: form.contact_name.trim() || null, contact_phone: form.contact_phone.trim() || null,
    contact_email: form.contact_email.trim() || null, line_id: form.line_id.trim() || null,
    social_url: form.social_url.trim() || null, website_url: form.website_url.trim() || null,
    ordering_instructions: form.ordering_instructions.trim() || null, menu_url: form.menu_url.trim() || null,
    hygiene_inspection_date: form.hygiene_inspection_date || null,
    hygiene_inspection_expires_at: form.hygiene_inspection_expires_at || null,
    hygiene_certificate_url: form.hygiene_certificate_url.trim() || null,
    hygiene_note: form.hygiene_note.trim() || null, status: form.status,
    sort_order: Number(form.sort_order) || 0, is_active: form.is_active,
    internal_note: form.internal_note.trim() || null, products: [],
  });

  const save = async () => {
    if (!form.name.trim()) { toast.error("商家名稱為必填"); return; }
    if (!form.category_id) { toast.error("請選擇商家分類"); return; }
    if (form.status === "active" && !form.hygiene_inspection_date) {
      toast.error("上架前請填寫衛生檢驗日期"); return;
    }
    setSaving(true);
    try {
      const vendor = selected
        ? await recommendedVendorsApi.update(selected.id, payload())
        : await recommendedVendorsApi.create(payload());
      setSelected(vendor);
      setForm(formFromVendor(vendor));
      await load();
      toast.success(selected ? "已更新推薦商家" : "已建立推薦商家");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const addProduct = async () => {
    if (!selected || !productForm.name.trim()) { toast.error("品項名稱為必填"); return; }
    try {
      const product = await recommendedVendorsApi.createProduct(selected.id, {
        ...productForm, name: productForm.name.trim(),
      });
      setSelected({ ...selected, products: [...selected.products, product], product_count: selected.product_count + 1 });
      setProductForm(emptyProduct);
      toast.success("已新增品項");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "新增品項失敗");
    }
  };

  const saveProduct = async (product: RecommendedVendorProductOut) => {
    try {
      const updated = await recommendedVendorsApi.updateProduct(product.id, product);
      if (selected) setSelected({ ...selected, products: selected.products.map((item) => item.id === updated.id ? updated : item) });
      toast.success("已更新品項");
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "更新品項失敗"); }
  };

  const removeProduct = async (product: RecommendedVendorProductOut) => {
    try {
      await recommendedVendorsApi.deleteProduct(product.id);
      if (selected) setSelected({ ...selected, products: selected.products.filter((item) => item.id !== product.id) });
      toast.success("已刪除品項");
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "刪除品項失敗"); }
  };

  const addMenuLink = async () => {
    if (!selected || !menuTitle.trim() || !menuUrl.trim()) { toast.error("菜單名稱與連結為必填"); return; }
    try {
      const menu = await recommendedVendorsApi.createMenu(selected.id, { title: menuTitle.trim(), url: menuUrl.trim() });
      setSelected({ ...selected, menus: [...selected.menus, menu] });
      setMenuTitle(""); setMenuUrl(""); toast.success("已新增菜單連結");
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "新增菜單連結失敗"); }
  };

  const uploadMenus = async (files: FileList | null) => {
    if (!selected || !files?.length) return;
    setUploading(true);
    try {
      const uploaded: RecommendedVendorMenuOut[] = [];
      for (const file of Array.from(files)) uploaded.push(await recommendedVendorsApi.uploadMenu(selected.id, file));
      setSelected({ ...selected, menus: [...selected.menus, ...uploaded] });
      toast.success(`已上傳 ${uploaded.length} 個菜單檔案`);
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "上傳菜單失敗"); }
    finally { setUploading(false); }
  };

  const removeMenu = async (menu: RecommendedVendorMenuOut) => {
    try {
      await recommendedVendorsApi.deleteMenu(menu.id);
      if (selected) setSelected({ ...selected, menus: selected.menus.filter((item) => item.id !== menu.id) });
      toast.success("已刪除菜單");
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "刪除菜單失敗"); }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>推薦商家管理</h1><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>必填欄位會標示「必填」；其餘欄位均可留白。</p></div>
        <div className="flex gap-2"><button type="button" className="btn btn-secondary" onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" />重新整理</button><button type="button" className="btn btn-primary" onClick={() => { setSelected(null); setForm(emptyForm); }}><Plus size={15} aria-hidden="true" />新增商家</button></div>
      </header>
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-lg border" style={{ borderColor: "var(--border)" }}><div className="flex items-center gap-2 border-b p-4" style={{ borderColor: "var(--border)" }}><Store size={16} aria-hidden="true" /><span className="font-semibold" style={{ color: "var(--text-primary)" }}>商家清單</span></div><div className="max-h-[calc(100vh-250px)] overflow-y-auto p-2">{loading ? <p className="p-3 text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p> : vendors.map((vendor) => <button type="button" key={vendor.id} onClick={() => void selectVendor(vendor.id)} className="w-full rounded-md p-3 text-left hover:bg-[var(--bg-elevated)]" style={{ background: selected?.id === vendor.id ? "var(--primary-dim)" : "transparent" }}><p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{vendor.name}</p><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{vendor.category || "未分類"} · {vendor.status} · {vendor.hygiene_verified ? "檢驗有效" : "待補檢驗"}</p></button>)}</div></aside>
        <section className="space-y-5">
          <VendorFormPanel form={form} categories={categories} selected={selected} saving={saving} update={update} onSave={save} />
          {selected && <MenuPanel selected={selected} menuTitle={menuTitle} menuUrl={menuUrl} uploading={uploading} setMenuTitle={setMenuTitle} setMenuUrl={setMenuUrl} addMenuLink={addMenuLink} uploadMenus={uploadMenus} removeMenu={removeMenu} />}
          {selected && <ProductPanel selected={selected} productForm={productForm} setProductForm={setProductForm} addProduct={addProduct} saveProduct={saveProduct} removeProduct={removeProduct} />}
          {selected && selected.status !== "archived" && <div className="flex justify-end"><button type="button" className="btn btn-secondary" onClick={async () => { if (!confirm("確定封存這間推薦商家？")) return; await recommendedVendorsApi.archive(selected.id); setSelected(null); setForm(emptyForm); await load(); toast.success("已封存商家"); }}><Archive size={15} aria-hidden="true" />封存商家</button></div>}
        </section>
      </div>
    </main>
  );
}

function VendorFormPanel({ form, categories, selected, saving, update, onSave }: { form: VendorForm; categories: RecommendedVendorCategoryOut[]; selected: RecommendedVendorOut | null; saving: boolean; update: <K extends keyof VendorForm>(key: K, value: VendorForm[K]) => void; onSave: () => void }) {
  return <section className="rounded-lg border p-5" style={{ borderColor: "var(--border)" }}><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>{selected ? `編輯：${selected.name}` : "建立推薦商家"}</h2><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>商家名稱、分類為必填；衛生檢驗日期在上架時必填，其餘資訊選填。</p></div><ShieldCheck size={22} style={{ color: "#15803D" }} aria-hidden="true" /></div><div className="grid gap-3 md:grid-cols-2">
    <Field label="商家名稱" required value={form.name} onChange={(value) => update("name", value)} />
    <label className="grid gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>分類 <Required /></span><select className="input" value={form.category_id} onChange={(event) => update("category_id", event.target.value)} required><option value="">請選擇分類</option>{categories.filter((category) => category.is_active || category.id === form.category_id).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{categories.length === 0 && <span className="text-xs" style={{ color: "#B91C1C" }}>請先到「分類」頁籤建立分類。</span>}</label>
    <Field label="簡介" value={form.summary} onChange={(value) => update("summary", value)} /><Field label="地址" value={form.address} onChange={(value) => update("address", value)} /><Field label="聯絡人" value={form.contact_name} onChange={(value) => update("contact_name", value)} /><Field label="電話" value={form.contact_phone} onChange={(value) => update("contact_phone", value)} /><Field label="Email" type="email" value={form.contact_email} onChange={(value) => update("contact_email", value)} /><Field label="LINE ID" value={form.line_id} onChange={(value) => update("line_id", value)} /><Field label="Google Maps 連結" type="url" value={form.google_maps_url} onChange={(value) => update("google_maps_url", value)} /><Field label="營業時間" value={form.business_hours_text} onChange={(value) => update("business_hours_text", value)} /><Field label="官方網站" type="url" value={form.website_url} onChange={(value) => update("website_url", value)} /><Field label="社群連結" type="url" value={form.social_url} onChange={(value) => update("social_url", value)} /><Field label="菜單主連結（選填）" type="url" value={form.menu_url} onChange={(value) => update("menu_url", value)} /><Field label="衛生檢驗日期（上架必填）" type="date" required={form.status === "active"} value={form.hygiene_inspection_date} onChange={(value) => update("hygiene_inspection_date", value)} /><Field label="檢驗有效期限" type="date" value={form.hygiene_inspection_expires_at} onChange={(value) => update("hygiene_inspection_expires_at", value)} /><Field label="檢驗證明連結" type="url" value={form.hygiene_certificate_url} onChange={(value) => update("hygiene_certificate_url", value)} /><Field label="排序" type="number" value={form.sort_order} onChange={(value) => update("sort_order", value)} /><label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={form.is_active} onChange={(event) => update("is_active", event.target.checked)} />允許顯示</label><TextArea label="介紹" value={form.description} onChange={(value) => update("description", value)} /><TextArea label="訂購方式" value={form.ordering_instructions} onChange={(value) => update("ordering_instructions", value)} placeholder="例如：請先電話預訂，取餐時付款。" /><TextArea label="衛生檢驗備註" value={form.hygiene_note} onChange={(value) => update("hygiene_note", value)} /><TextArea label="管理備註" value={form.internal_note} onChange={(value) => update("internal_note", value)} />
    <label className="grid gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>狀態 <Optional /></span><select className="input" value={form.status} onChange={(event) => update("status", event.target.value as RecommendedVendorStatus)}><option value="draft">草稿</option><option value="active">上架</option><option value="hidden">暫不上架</option><option value="archived">已封存</option></select></label>
  </div><div className="mt-4 flex justify-end"><button type="button" className="btn btn-primary" disabled={saving} onClick={onSave}><Save size={15} aria-hidden="true" />{saving ? "儲存中…" : "儲存商家"}</button></div></section>;
}

function MenuPanel({ selected, menuTitle, menuUrl, uploading, setMenuTitle, setMenuUrl, addMenuLink, uploadMenus, removeMenu }: { selected: RecommendedVendorOut; menuTitle: string; menuUrl: string; uploading: boolean; setMenuTitle: (value: string) => void; setMenuUrl: (value: string) => void; addMenuLink: () => Promise<void>; uploadMenus: (files: FileList | null) => Promise<void>; removeMenu: (menu: RecommendedVendorMenuOut) => Promise<void> }) {
  return <section className="rounded-lg border p-5" style={{ borderColor: "var(--border)" }}><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>菜單檔案與連結</h2><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>選填；可新增多個外部連結，或一次選取多個圖片／PDF。前台會提供預覽。</p></div><label className="btn btn-secondary cursor-pointer"><Upload size={15} aria-hidden="true" />{uploading ? "上傳中…" : "上傳圖片／PDF"}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" multiple disabled={uploading} onChange={(event) => { void uploadMenus(event.target.files); event.currentTarget.value = ""; }} /></label></div><div className="mt-4 grid gap-2 md:grid-cols-[1fr_1.5fr_auto]"><Field label="連結名稱" required value={menuTitle} onChange={setMenuTitle} /><Field label="菜單連結" type="url" required value={menuUrl} onChange={setMenuUrl} /><button type="button" className="btn btn-secondary self-end" onClick={() => void addMenuLink()}><Plus size={15} aria-hidden="true" />新增連結</button></div><div className="mt-4 space-y-2">{selected.menus.length === 0 ? <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚未提供菜單。</p> : selected.menus.map((menu) => <MenuRow key={menu.id} menu={menu} onDelete={removeMenu} />)}</div></section>;
}

function ProductPanel({ selected, productForm, setProductForm, addProduct, saveProduct, removeProduct }: { selected: RecommendedVendorOut; productForm: typeof emptyProduct; setProductForm: (value: typeof emptyProduct) => void; addProduct: () => Promise<void>; saveProduct: (product: RecommendedVendorProductOut) => Promise<void>; removeProduct: (product: RecommendedVendorProductOut) => Promise<void> }) {
  return <section className="rounded-lg border p-5" style={{ borderColor: "var(--border)" }}><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>商品資訊</h2><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>選填；沒有提供時，學生端不顯示品項。</p></div><button type="button" className="btn btn-secondary" onClick={() => void addProduct()}><Plus size={15} aria-hidden="true" />新增品項</button></div><div className="mt-4 grid gap-2 md:grid-cols-3"><Field label="品項名稱" required value={productForm.name} onChange={(value) => setProductForm({ ...productForm, name: value })} /><Field label="價格" value={productForm.price_text} onChange={(value) => setProductForm({ ...productForm, price_text: value })} /><Field label="品項說明" value={productForm.description} onChange={(value) => setProductForm({ ...productForm, description: value })} /></div><div className="mt-4 space-y-3">{selected.products.map((product) => <ProductRow key={product.id} product={product} onSave={saveProduct} onDelete={removeProduct} />)}</div></section>;
}

function Field({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return <label className="grid gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>{label} {required ? <Required /> : <Optional />}</span><input className="input" type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>;
}
function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="grid gap-1 text-sm md:col-span-2"><span style={{ color: "var(--text-secondary)" }}>{label} <Optional /></span><textarea className="input min-h-20" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}
function MenuRow({ menu, onDelete }: { menu: RecommendedVendorMenuOut; onDelete: (menu: RecommendedVendorMenuOut) => Promise<void> }) {
  const href = menu.url?.startsWith("/") ? apiUrl(menu.url) : menu.url || "";
  return <div className="flex items-center justify-between gap-3 rounded-md border p-3" style={{ borderColor: "var(--border)" }}><div className="flex min-w-0 items-center gap-2">{menu.kind === "image" ? <ImageIcon size={16} aria-hidden="true" /> : menu.kind === "pdf" ? <FileText size={16} aria-hidden="true" /> : <ExternalLink size={16} aria-hidden="true" />}<a className="truncate text-sm hover:underline" href={href} target="_blank" rel="noreferrer" style={{ color: "var(--text-primary)" }}>{menu.title}</a><span className="text-xs" style={{ color: "var(--text-muted)" }}>{menu.kind === "link" ? "連結" : menu.kind.toUpperCase()}</span></div><button type="button" className="btn btn-secondary" onClick={() => void onDelete(menu)} aria-label={`刪除 ${menu.title}`}><Trash2 size={15} aria-hidden="true" /></button></div>;
}
function ProductRow({ product, onSave, onDelete }: { product: RecommendedVendorProductOut; onSave: (product: RecommendedVendorProductOut) => Promise<void>; onDelete: (product: RecommendedVendorProductOut) => Promise<void> }) {
  const [draft, setDraft] = useState(product);
  return <div className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_150px_1.5fr_auto]" style={{ borderColor: "var(--border)" }}><input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /><input className="input" value={draft.price_text || ""} onChange={(event) => setDraft({ ...draft, price_text: event.target.value })} /><input className="input" value={draft.description || ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /><div className="flex gap-2"><button type="button" className="btn btn-secondary" onClick={() => void onSave(draft)} aria-label={`儲存 ${draft.name}`}><Check size={15} /></button><button type="button" className="btn btn-secondary" onClick={() => void onDelete(draft)} aria-label={`刪除 ${draft.name}`}><Trash2 size={15} /></button></div></div>;
}
function Required() { return <em className="not-italic" style={{ color: "#B91C1C" }}>必填</em>; }
function Optional() { return <span className="font-normal" style={{ color: "var(--text-muted)" }}>選填</span>; }
