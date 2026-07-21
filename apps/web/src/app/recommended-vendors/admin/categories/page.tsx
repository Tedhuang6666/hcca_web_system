"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Edit3, Save, Tags, X } from "lucide-react";
import { toast } from "sonner";
import { recommendedVendorsApi, ApiError } from "@/lib/api";
import type { RecommendedVendorCategoryOut } from "@/lib/types";

type CategoryForm = { name: string; description: string; sort_order: string; is_active: boolean };
const emptyForm: CategoryForm = { name: "", description: "", sort_order: "0", is_active: true };

export default function RecommendedVendorCategoriesPage() {
  const [categories, setCategories] = useState<RecommendedVendorCategoryOut[]>([]);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCategories(await recommendedVendorsApi.listCategoriesAdmin()); }
    catch (error) { toast.error(error instanceof ApiError ? error.message : "載入分類失敗"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!form.name.trim()) { toast.error("分類名稱為必填"); return; }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), description: form.description.trim() || null, sort_order: Number(form.sort_order) || 0, is_active: form.is_active };
      if (editingId) await recommendedVendorsApi.updateCategory(editingId, payload);
      else await recommendedVendorsApi.createCategory(payload);
      setForm(emptyForm); setEditingId(null); await load(); toast.success(editingId ? "已更新分類" : "已建立分類");
    } catch (error) { toast.error(error instanceof ApiError ? error.message : "儲存分類失敗"); }
    finally { setSaving(false); }
  };

  const edit = (category: RecommendedVendorCategoryOut) => {
    setEditingId(category.id);
    setForm({ name: category.name, description: category.description || "", sort_order: String(category.sort_order), is_active: category.is_active });
  };

  return (
    <main className="mx-auto max-w-5xl space-y-5">
      <header>
        <p className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--primary)" }}><Tags size={16} aria-hidden="true" />統一管理選項</p>
        <h1 className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>商家分類</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>先在這裡建立分類，商家資料只需從下拉選單選擇。</p>
      </header>
      <section className="rounded-lg border p-5" style={{ borderColor: "var(--border)" }}>
        <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>{editingId ? "編輯分類" : "新增分類"}</h2>{editingId && <button type="button" className="btn btn-secondary" onClick={() => { setEditingId(null); setForm(emptyForm); }}><X size={15} aria-hidden="true" />取消編輯</button>}</div>
        <div className="grid gap-3 md:grid-cols-[1fr_1.5fr_120px_auto]">
          <label className="grid gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>分類名稱 <Required /></span><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：便當、飲料" required /></label>
          <label className="grid gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>說明 <Optional /></span><input className="input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label className="grid gap-1 text-sm"><span style={{ color: "var(--text-secondary)" }}>排序 <Optional /></span><input className="input" type="number" value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} /></label>
          <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />啟用</label>
        </div>
        <div className="mt-4 flex justify-end"><button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}><Save size={15} aria-hidden="true" />{saving ? "儲存中…" : editingId ? "儲存分類" : "建立分類"}</button></div>
      </section>
      <section className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2 border-b p-4" style={{ borderColor: "var(--border)" }}><Check size={16} style={{ color: "#15803D" }} aria-hidden="true" /><h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>分類清單</h2></div>
        {loading ? <p className="p-5 text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p> : categories.length === 0 ? <p className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>尚未建立分類。</p> : <div className="divide-y" style={{ borderColor: "var(--border)" }}>{categories.map((category) => <div key={category.id} className="flex items-center justify-between gap-4 p-4"><div><p className="font-medium" style={{ color: "var(--text-primary)" }}>{category.name} {!category.is_active && <span className="text-xs" style={{ color: "var(--text-muted)" }}>（停用）</span>}</p>{category.description && <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{category.description}</p>}</div><button type="button" className="btn btn-secondary" onClick={() => edit(category)}><Edit3 size={15} aria-hidden="true" />編輯</button></div>)}</div>}
      </section>
    </main>
  );
}

function Required() { return <em className="not-italic" style={{ color: "#B91C1C" }}>必填</em>; }
function Optional() { return <span className="font-normal" style={{ color: "var(--text-muted)" }}>選填</span>; }
