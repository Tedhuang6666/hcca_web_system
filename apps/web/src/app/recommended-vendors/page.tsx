"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, FileText, Image as ImageIcon, Link2, MapPin, Menu, Phone, Search, ShieldCheck, Store, X } from "lucide-react";
import { toast } from "sonner";
import { recommendedVendorsApi, ApiError } from "@/lib/api";
import { apiUrl } from "@/lib/config";
import type { RecommendedVendorCategoryOut, RecommendedVendorListItem, RecommendedVendorOut } from "@/lib/types";

type VendorDetail = Omit<RecommendedVendorOut, "products" | "menus"> & {
  products: NonNullable<RecommendedVendorOut["products"]>;
  menus: NonNullable<RecommendedVendorOut["menus"]>;
};

const RecommendedVendorMap = dynamic(() => import("./RecommendedVendorMap"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>載入地圖中…</div>,
});

function inspectionText(item: RecommendedVendorListItem | RecommendedVendorOut): string {
  return item.hygiene_inspection_expires_at
    ? `檢驗有效至 ${item.hygiene_inspection_expires_at}`
    : `檢驗日期 ${item.hygiene_inspection_date ?? "—"}`;
}

function FilePreviewIcon({ kind }: { kind: "link" | "image" | "pdf" }) {
  const Icon = kind === "image" ? ImageIcon : kind === "pdf" ? FileText : Link2;
  return <Icon size={22} style={{ color: "var(--primary)" }} aria-hidden="true" />;
}

function menuHref(url: string | null): string {
  return url?.startsWith("/") ? apiUrl(url) : url || "";
}

function VendorDetail({ vendor, onClose }: { vendor: VendorDetail; onClose: () => void }) {
  return (
    <aside className="space-y-5 rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1 text-xs font-semibold" style={{ color: "#15803D" }}><ShieldCheck size={14} aria-hidden="true" />衛生檢驗有效</p>
          <h2 className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{vendor.name}</h2>
          {vendor.category && <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{vendor.category}</p>}
        </div>
        <button type="button" className="topbar-icon-btn" onClick={onClose} aria-label="關閉商家詳情"><X size={16} /></button>
      </div>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{vendor.summary || vendor.description || "目前沒有商家介紹。"}</p>
      <div className="grid gap-3 text-sm" style={{ color: "var(--text-secondary)" }}>
        {vendor.address && <p className="flex gap-2"><MapPin size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{vendor.address}</p>}
        {vendor.contact_phone && <a className="flex gap-2 hover:underline" href={`tel:${vendor.contact_phone}`}><Phone size={16} aria-hidden="true" />{vendor.contact_phone}</a>}
        {vendor.contact_email && <a className="flex gap-2 hover:underline" href={`mailto:${vendor.contact_email}`}><ExternalLink size={16} aria-hidden="true" />{vendor.contact_email}</a>}
        {vendor.line_id && <p>LINE：{vendor.line_id}</p>}
        {vendor.business_hours_text && <p>營業時間：{vendor.business_hours_text}</p>}
      </div>
      <div className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
        <p className="font-medium" style={{ color: "var(--text-primary)" }}>訂購方式</p>
        <p className="mt-1 whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{vendor.ordering_instructions || "請直接聯絡商家確認訂購方式。"}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {vendor.google_maps_url && <a className="btn btn-secondary" href={vendor.google_maps_url} target="_blank" rel="noreferrer"><MapPin size={15} aria-hidden="true" />Google Maps</a>}
        {vendor.menu_url && <a className="btn btn-secondary" href={vendor.menu_url} target="_blank" rel="noreferrer"><Menu size={15} aria-hidden="true" />查看菜單</a>}
        {vendor.website_url && <a className="btn btn-secondary" href={vendor.website_url} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />官方網站</a>}
      </div>
      <section>
        {vendor.menus.length > 0 && <section className="mb-5"><h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>菜單</h3><div className="mt-2 grid gap-3 sm:grid-cols-2">{vendor.menus.map((menu) => <a key={menu.id} className="group overflow-hidden rounded-md border" href={menuHref(menu.url)} target="_blank" rel="noreferrer" style={{ borderColor: "var(--border)" }}>{menu.kind === "image" && menu.url ? <img src={menuHref(menu.url)} alt={menu.title} className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.02]" /> : <div className="flex min-h-24 items-center gap-3 p-4" style={{ background: "var(--bg)" }}><FilePreviewIcon kind={menu.kind} /><div><p className="font-medium" style={{ color: "var(--text-primary)" }}>{menu.title}</p><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{menu.kind === "pdf" ? "PDF 預覽" : "開啟菜單連結"}</p></div></div>}</a>)}</div></section>}
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>菜單／商品資訊</h3>
        {vendor.products.length === 0 ? <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>店家尚未提供品項資訊。</p> : (
          <div className="mt-2 divide-y rounded-md border" style={{ borderColor: "var(--border)" }}>
            {vendor.products.map((product) => <div key={product.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div><p className="font-medium" style={{ color: "var(--text-primary)" }}>{product.name}</p>{product.description && <p className="mt-1" style={{ color: "var(--text-muted)" }}>{product.description}</p>}</div>
              {product.price_text && <span className="shrink-0 font-medium" style={{ color: "var(--primary)" }}>{product.price_text}</span>}
            </div>)}
          </div>
        )}
      </section>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{inspectionText(vendor)}{vendor.hygiene_note ? ` · ${vendor.hygiene_note}` : ""}</p>
    </aside>
  );
}

export default function RecommendedVendorsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [vendors, setVendors] = useState<RecommendedVendorListItem[]>([]);
  const [categories, setCategories] = useState<RecommendedVendorCategoryOut[]>([]);
  const [selected, setSelected] = useState<VendorDetail | null>(null);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("all");
  const [mode, setMode] = useState<"list" | "map">("list");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vendorRows, categoryRows] = await Promise.all([
        recommendedVendorsApi.list({ keyword: keyword.trim() || undefined, category_id: category === "all" ? undefined : category }),
        recommendedVendorsApi.listCategories(),
      ]);
      setVendors(vendorRows); setCategories(categoryRows);
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "載入推薦商家失敗"); }
    finally { setLoading(false); }
  }, [category, keyword]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setMode(searchParams.get("view") === "map" ? "map" : "list");
  }, [searchParams]);
  const open = async (id: string) => {
    try {
      const vendor = await recommendedVendorsApi.get(id);
      setSelected({ ...vendor, menus: vendor.menus ?? [], products: vendor.products ?? [] });
    }
    catch (error) { toast.error(error instanceof ApiError ? error.message : "載入商家資訊失敗"); }
  };

  return (
    <main className="mx-auto max-w-6xl space-y-5">
      <header className="workspace-header flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div><h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>推薦商家</h1><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>整理通過衛生檢驗、方便學生聯絡訂購的校園周邊商家。</p></div>
        <div className="flex gap-2" role="group" aria-label="檢視方式">
          <button type="button" className={`btn ${mode === "list" ? "btn-primary" : "btn-secondary"}`} onClick={() => { setMode("list"); router.replace("/recommended-vendors"); }}><Store size={15} aria-hidden="true" />清單</button>
          <button type="button" className={`btn ${mode === "map" ? "btn-primary" : "btn-secondary"}`} onClick={() => { setMode("map"); router.replace("/recommended-vendors?view=map"); }}><MapPin size={15} aria-hidden="true" />地圖</button>
        </div>
      </header>
      <section className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <label className="relative block min-w-0"><Search size={16} className="absolute left-3 top-3" style={{ color: "var(--text-muted)" }} aria-hidden="true" /><input className="input w-full pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜尋商家、分類或地址" /></label>
        <select className="input w-full" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="商家分類"><option value="all">全部分類</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button type="button" className="btn btn-secondary w-full md:w-auto" onClick={() => void load()}>搜尋</button>
      </section>
      {mode === "map" ? <><div className="h-[min(70vh,620px)] min-h-[460px] overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)" }}><RecommendedVendorMap items={vendors} onSelect={(id) => void open(id)} /></div>{selected && <div className="mx-auto mt-5 max-w-xl"><VendorDetail vendor={selected} onClose={() => setSelected(null)} /></div>}</> : (
        <div className={selected ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]" : ""}>
          <section aria-live="polite">
            {loading ? <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入推薦商家中…</p> : vendors.length === 0 ? <div className="rounded-lg border p-10 text-center" style={{ borderColor: "var(--border)" }}><ShieldCheck className="mx-auto" size={28} style={{ color: "var(--text-muted)" }} /><p className="mt-3 font-medium" style={{ color: "var(--text-primary)" }}>目前沒有符合條件的商家</p><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>試著移除分類或搜尋關鍵字。</p></div> : <div className="divide-y rounded-lg border" style={{ borderColor: "var(--border)" }}>{vendors.map((vendor) => <button type="button" key={vendor.id} onClick={() => void open(vendor.id)} className="flex w-full items-start justify-between gap-4 p-4 text-left transition-colors hover:bg-[var(--bg-elevated)]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>{vendor.name}</h2><span className="flex items-center gap-1 text-xs font-medium" style={{ color: "#15803D" }}><ShieldCheck size={13} aria-hidden="true" />檢驗有效</span>{vendor.category && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{vendor.category}</span>}</div><p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{vendor.summary || "提供商家聯絡與訂購資訊"}</p><p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs" style={{ color: "var(--text-muted)" }}>{vendor.address && <span>{vendor.address}</span>}{vendor.contact_phone && <span>{vendor.contact_phone}</span>}{vendor.product_count > 0 && <span>{vendor.product_count} 項商品資訊</span>}</p></div><ExternalLink size={16} className="mt-1 shrink-0" style={{ color: "var(--text-muted)" }} aria-hidden="true" /></button>)}</div>}
          </section>
          {selected && <VendorDetail vendor={selected} onClose={() => setSelected(null)} />}
        </div>
      )}
    </main>
  );
}
