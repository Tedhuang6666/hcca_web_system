"use client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { shopApi, ApiError } from "@/lib/api";
import type { ProductOut } from "@/lib/types";
import { ProductStatusBadge } from "@/components/ui/StatusBadge";

function ProductCard({ product, onOrder }: { product: ProductOut; onOrder: (p: ProductOut) => void }) {
  const available = product.status === "active" && (product.is_unlimited || product.stock_quantity > 0);
  return (
    <div className="card card-hover p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm truncate" style={{ color: "var(--text-primary)" }}>
            {product.name}
          </h3>
          {product.description && (
            <p className="text-xs mt-1.5 line-clamp-2" style={{ color: "var(--text-muted)" }}>
              {product.description}
            </p>
          )}
        </div>
        <ProductStatusBadge status={product.status} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-xl font-bold" style={{ color: "var(--primary)" }}>
            NT${product.price.toLocaleString()}
          </span>
          <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>
            {product.is_unlimited ? "無限量" : `剩 ${product.stock_quantity} 件`}
          </span>
        </div>
        {product.sale_end && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            截止 {new Date(product.sale_end).toLocaleDateString("zh-TW")}
          </span>
        )}
      </div>

      <button
        onClick={() => onOrder(product)}
        disabled={!available}
        className="btn w-full"
        style={
          available
            ? { background: "var(--primary)", color: "var(--primary-fg)", border: "none" }
            : { background: "var(--bg-elevated)", color: "var(--text-disabled)", border: "1px solid var(--border)" }
        }>
        {available ? "立即購買" : "無法購買"}
      </button>
    </div>
  );
}

function OrderModal({ product, onClose, onDone }: {
  product: ProductOut; onClose: () => void; onDone: () => void;
}) {
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await shopApi.createOrder({
        items: [{ product_id: product.id, quantity: qty }],
        notes: notes || undefined,
      });
      toast.success("訂單建立成功！");
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error("庫存不足或已被搶購，請重新整理後再試");
      } else {
        toast.error(e instanceof ApiError ? e.message : "訂購失敗");
      }
    } finally { setLoading(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "var(--bg-overlay)" }}
      role="dialog"
      aria-modal="true"
      aria-label="確認購買">
      {/* 背景點擊關閉 */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div
        className="relative max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto card p-6 space-y-4 animate-scale-in"
        style={{ boxShadow: "var(--shadow-xl)" }}>
        {/* 標頭 */}
        <div className="flex items-center justify-between">
          <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>確認購買</h3>
          <button
            onClick={onClose}
            className="topbar-icon-btn"
            aria-label="關閉">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 商品資訊 */}
        <div className="rounded-xl p-3.5 space-y-1"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {product.name}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            NT${product.price.toLocaleString()} × {qty} ={" "}
            <span style={{ color: "var(--primary)", fontWeight: 600 }}>
              NT${(product.price * qty).toLocaleString()}
            </span>
          </p>
        </div>

        {/* 數量 */}
        <div>
          <label className="text-xs font-medium block mb-2" style={{ color: "var(--text-secondary)" }}>
            數量
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="btn btn-ghost w-9 h-9 p-0"
              aria-label="減少數量">
              −
            </button>
            <span className="text-base font-semibold w-8 text-center" style={{ color: "var(--text-primary)" }}>
              {qty}
            </span>
            <button
              onClick={() => setQty((q) =>
                product.is_unlimited ? q + 1 : Math.min(product.stock_quantity, q + 1)
              )}
              className="btn btn-ghost w-9 h-9 p-0"
              aria-label="增加數量">
              ＋
            </button>
          </div>
        </div>

        {/* 備註 */}
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-secondary)" }}>
            備註（選填）
          </label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="特殊需求…"
            className="input"
          />
        </div>

        {/* 操作 */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={submit}
            disabled={loading}
            className="btn flex-1"
            style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}
            aria-busy={loading}>
            {loading ? "處理中…" : `確認 NT$${(product.price * qty).toLocaleString()}`}
          </button>
          <button onClick={onClose} className="btn btn-ghost px-5">取消</button>
        </div>
      </div>
    </div>
  );
}

const SORT_OPTIONS = [
  { key: "default", label: "預設排序" },
  { key: "price_asc", label: "價格低→高" },
  { key: "price_desc", label: "價格高→低" },
  { key: "name_asc", label: "名稱 A→Z" },
];

export default function ShopPage() {
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState<ProductOut | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("default");

  const load = () => {
    setLoading(true);
    shopApi
      .listProducts({ status: "active" })
      .then(setProducts)
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const displayed = products
    .filter(p => !search.trim() || p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortKey === "price_asc")  return a.price - b.price;
      if (sortKey === "price_desc") return b.price - a.price;
      if (sortKey === "name_asc")   return a.name.localeCompare(b.name, "zh-TW");
      return 0;
    });

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>訂購系統</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>購買票券與活動商品</p>
        </div>
        <Link
          href="/shop/orders"
          className="btn btn-ghost self-start sm:self-auto">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
          </svg>
          我的訂單
        </Link>
      </div>

      {/* 搜尋 + 排序 */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" style={{ color: "var(--text-muted)" }} aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜尋商品名稱或描述…"
            className="input pl-9 w-full"
            aria-label="搜尋商品" />
        </div>
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value)}
          className="input w-40 flex-shrink-0"
          aria-label="排序方式"
          style={{ cursor: "pointer" }}>
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>
          <div
            className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
            style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }}
            role="status" aria-label="載入中" />
          <p className="text-sm">載入中…</p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" className="mx-auto mb-3 opacity-40" aria-hidden="true">
            <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          <p className="text-sm">{search ? `找不到「${search}」相關商品` : "目前沒有上架商品"}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayed.map((p) => (
            <ProductCard key={p.id} product={p} onOrder={setOrdering} />
          ))}
        </div>
      )}

      {ordering && (
        <OrderModal
          product={ordering}
          onClose={() => setOrdering(null)}
          onDone={() => { setOrdering(null); load(); }}
        />
      )}
    </div>
  );
}
