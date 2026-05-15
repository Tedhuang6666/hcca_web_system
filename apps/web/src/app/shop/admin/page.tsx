"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { shopApi, orgsApi, ApiError } from "@/lib/api";
import type { OrgRead } from "@/lib/api";
import type { ProductOut, ProductStatus } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";

/* ── 狀態標籤 ───────────────────────────────────────────────────────────────── */
const STATUS_CFG: Record<ProductStatus, { label: string; color: string; bg: string }> = {
  draft:    { label: "草稿",  color: "var(--text-muted)",  bg: "var(--bg-elevated)" },
  active:   { label: "上架中", color: "var(--success)",    bg: "var(--success-dim)" },
  sold_out: { label: "售完",  color: "var(--warning)",    bg: "var(--warning-dim)" },
  archived: { label: "下架",  color: "var(--text-muted)", bg: "var(--bg-elevated)" },
};

/* ── 商品表單 ───────────────────────────────────────────────────────────────── */
interface ProductFormValues {
  name: string;
  description: string;
  price: string;
  stock_quantity: string;
  is_unlimited: boolean;
  sale_start: string;
  sale_end: string;
  org_id: string;
}

const EMPTY_FORM: ProductFormValues = {
  name: "", description: "", price: "", stock_quantity: "0",
  is_unlimited: false, sale_start: "", sale_end: "", org_id: "",
};

function productToForm(p: ProductOut): ProductFormValues {
  return {
    name: p.name,
    description: p.description ?? "",
    price: String(p.price),
    stock_quantity: String(p.stock_quantity),
    is_unlimited: p.is_unlimited,
    sale_start: p.sale_start ? p.sale_start.slice(0, 16) : "",
    sale_end:   p.sale_end   ? p.sale_end.slice(0, 16)   : "",
    org_id: p.org_id,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */

export default function ShopAdminPage() {
  const router = useRouter();
  const { can } = usePermissions();

  // 未授權時導回
  useEffect(() => {
    if (!can("shop:manage")) router.replace("/shop");
  }, [can, router]);

  const [products, setProducts] = useState<ProductOut[]>([]);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [loading, setLoading] = useState(true);

  // 新增/編輯 Modal
  const [modal, setModal] = useState<"none" | "create" | "edit">("none");
  const [editTarget, setEditTarget] = useState<ProductOut | null>(null);
  const [form, setForm] = useState<ProductFormValues>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, orgItems] = await Promise.all([
        shopApi.listProducts(),
        orgsApi.list().catch(() => []),
      ]);
      setProducts(data);
      setOrgs(orgItems);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    const storedOrgId = localStorage.getItem("org_id") ?? "";
    setForm({
      ...EMPTY_FORM,
      org_id: storedOrgId || (orgs.length === 1 ? orgs[0].id : ""),
    });
    setEditTarget(null);
    setModal("create");
  }

  function openEdit(p: ProductOut) {
    setForm(productToForm(p));
    setEditTarget(p);
    setModal("edit");
  }

  function closeModal() { setModal("none"); setEditTarget(null); }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("請填寫商品名稱"); return; }
    if (modal === "create" && !form.org_id) { toast.error("請選擇所屬組織"); return; }
    const price = parseFloat(form.price);
    if (isNaN(price) || price < 0) { toast.error("價格格式錯誤"); return; }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description || null,
        price,
        stock_quantity: form.is_unlimited ? 0 : parseInt(form.stock_quantity) || 0,
        is_unlimited: form.is_unlimited,
        sale_start: form.sale_start || null,
        sale_end:   form.sale_end   || null,
      };

      if (modal === "create") {
        body.org_id = form.org_id;
        await shopApi.createProduct(body);
        toast.success("商品已建立");
      } else if (editTarget) {
        await shopApi.updateProduct(editTarget.id, body);
        toast.success("商品已更新");
      }
      closeModal();
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(p: ProductOut) {
    const isActive = p.status === "active";
    try {
      if (isActive) {
        await shopApi.deactivateProduct(p.id);
        toast.success(`「${p.name}」已下架`);
      } else {
        await shopApi.activateProduct(p.id);
        toast.success(`「${p.name}」已上架`);
      }
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失敗");
    }
  }

  const active = products.filter(p => p.status === "active").length;

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* 頁首 */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/shop"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ border: "1px solid var(--border)" }}
            aria-label="返回訂購系統"
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>商品管理</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
              共 {products.length} 項商品 · {active} 項上架中
            </p>
          </div>
        </div>
        <button onClick={openCreate} className="btn btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新增商品
        </button>
      </div>

      {/* 商品列表 */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
            <div className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
              style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }}
              role="status" aria-label="載入中" />
            <p className="text-sm">載入中…</p>
          </div>
        ) : products.length === 0 ? (
          <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
            <p className="text-sm mb-3">尚無商品</p>
            <button onClick={openCreate} className="btn btn-primary text-xs">新增第一個商品</button>
          </div>
        ) : (
          <table className="w-full text-sm" role="table" aria-label="商品列表">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["商品名稱", "價格", "庫存", "狀態", "操作"].map(h => (
                  <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold"
                    style={{ color: "var(--text-muted)" }} scope="col">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p, idx) => {
                const cfg = STATUS_CFG[p.status] ?? STATUS_CFG.draft;
                return (
                  <tr
                    key={p.id}
                    style={idx < products.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <td className="px-5 py-4">
                      <p className="font-medium" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                      {p.description && (
                        <p className="text-xs mt-0.5 truncate max-w-xs" style={{ color: "var(--text-muted)" }}>
                          {p.description}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4 font-medium" style={{ color: "var(--text-primary)" }}>
                      NT${p.price.toLocaleString()}
                    </td>
                    <td className="px-5 py-4 text-sm" style={{ color: "var(--text-secondary)" }}>
                      {p.is_unlimited ? "不限量" : `${p.stock_quantity} 件`}
                    </td>
                    <td className="px-5 py-4">
                      <span className="badge" style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.color }}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className="btn btn-ghost text-xs px-3 py-1.5"
                          style={{ minHeight: "auto" }}>
                          編輯
                        </button>
                        <button
                          onClick={() => toggleStatus(p)}
                          className="btn btn-ghost text-xs px-3 py-1.5"
                          style={{
                            minHeight: "auto",
                            color: p.status === "active" ? "var(--danger)" : "var(--success)",
                          }}>
                          {p.status === "active" ? "下架" : "上架"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 新增/編輯 Modal */}
      {modal !== "none" && (
        <Modal
          title={modal === "create" ? "新增商品" : "編輯商品"}
          onClose={closeModal}
          maxWidthClassName="max-w-lg"
        >
          <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                  商品名稱 <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="input w-full"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="請輸入商品名稱"
                  maxLength={100}
                />
              </div>

              {modal === "create" && (
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                    所屬組織 <span style={{ color: "var(--danger)" }}>*</span>
                  </label>
                  <select
                    className="input w-full"
                    value={form.org_id}
                    onChange={e => setForm(f => ({ ...f, org_id: e.target.value }))}>
                    <option value="">選擇組織…</option>
                    {orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                  商品描述
                </label>
                <textarea
                  className="input w-full resize-none"
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="選填"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                    售價（NT$）<span style={{ color: "var(--danger)" }}>*</span>
                  </label>
                  <input
                    type="number" min="0" className="input w-full"
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                    庫存數量
                  </label>
                  <input
                    type="number" min="0" className="input w-full"
                    value={form.stock_quantity}
                    disabled={form.is_unlimited}
                    onChange={e => setForm(f => ({ ...f, stock_quantity: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_unlimited}
                  onChange={e => setForm(f => ({ ...f, is_unlimited: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>不限庫存（無限量）</span>
              </label>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                    開賣時間（選填）
                  </label>
                  <input
                    type="datetime-local" className="input w-full"
                    value={form.sale_start}
                    onChange={e => setForm(f => ({ ...f, sale_start: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
                    結賣時間（選填）
                  </label>
                  <input
                    type="datetime-local" className="input w-full"
                    value={form.sale_end}
                    onChange={e => setForm(f => ({ ...f, sale_end: e.target.value }))}
                  />
                </div>
              </div>
          </div>

          {/* Modal 底部 */}
          <div className="pt-4 mt-4 flex justify-end gap-3"
            style={{ borderTop: "1px solid var(--border)" }}>
            <button onClick={closeModal} className="btn btn-ghost" disabled={saving}>
              取消
            </button>
            <button onClick={handleSave} className="btn btn-primary" disabled={saving}>
              {saving ? "儲存中…" : (modal === "create" ? "建立商品" : "儲存變更")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
