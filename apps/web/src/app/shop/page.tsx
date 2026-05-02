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
    <div className="glass p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-slate-100 text-sm">{product.name}</h3>
          {product.description && <p className="text-xs mt-1 text-slate-400 line-clamp-2">{product.description}</p>}
        </div>
        <ProductStatusBadge status={product.status} />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <span className="text-lg font-bold" style={{ color: "var(--accent)" }}>
            NT${product.price.toLocaleString()}
          </span>
          <span className="text-xs ml-2" style={{ color: "var(--muted)" }}>
            {product.is_unlimited ? "無限量" : `剩 ${product.stock_quantity} 件`}
          </span>
        </div>
        {product.sale_end && (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            截止：{new Date(product.sale_end).toLocaleDateString("zh-TW")}
          </span>
        )}
      </div>
      <button onClick={() => onOrder(product)} disabled={!available}
        className="w-full py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
        style={available
          ? { background: "var(--accent)", color: "#0a0e1a" }
          : { background: "var(--bg-elevated)", color: "var(--muted)", border: "1px solid var(--border)" }}>
        {available ? "立即購買" : "無法購買"}
      </button>
    </div>
  );
}

function OrderModal({ product, onClose, onDone }: { product: ProductOut; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await shopApi.createOrder({ items: [{ product_id: product.id, quantity: qty }], notes: notes || undefined });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="w-full max-w-md glass p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-100">確認購買</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>
        <div className="glass p-3 space-y-1">
          <p className="text-sm font-medium text-slate-200">{product.name}</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            NT${product.price.toLocaleString()} × {qty} = NT${(product.price * qty).toLocaleString()}
          </p>
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>數量</label>
          <div className="flex items-center gap-3">
            <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-8 h-8 rounded text-slate-300 hover:text-slate-100"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>−</button>
            <span className="text-slate-200 font-medium w-8 text-center">{qty}</span>
            <button onClick={() => setQty(q => product.is_unlimited ? q + 1 : Math.min(product.stock_quantity, q + 1))}
              className="w-8 h-8 rounded text-slate-300 hover:text-slate-100"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>＋</button>
          </div>
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>備註（選填）</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="特殊需求..."
            className="w-full bg-transparent text-slate-300 text-sm px-2 py-1.5 rounded outline-none"
            style={{ border: "1px solid var(--border)" }} />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={submit} disabled={loading}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--accent)", color: "#0a0e1a" }}>
            {loading ? "處理中..." : `確認訂購 NT$${(product.price * qty).toLocaleString()}`}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm" style={{ color: "var(--muted)" }}>取消</button>
        </div>
      </div>
    </div>
  );
}

export default function ShopPage() {
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState<ProductOut | null>(null);

  const load = () => {
    setLoading(true);
    shopApi.listProducts({ status: "active" })
      .then(setProducts)
      .catch(e => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">訂購系統</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>購買票券與活動商品</p>
        </div>
        <Link href="/shop/orders" className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "var(--bg-elevated)", color: "var(--accent)", border: "1px solid var(--border-glow)" }}>
          📋 我的訂單
        </Link>
      </div>

      {loading ? (
        <div className="py-20 text-center text-slate-500">載入中...</div>
      ) : products.length === 0 ? (
        <div className="py-20 text-center text-slate-500">目前沒有上架商品</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map(p => <ProductCard key={p.id} product={p} onOrder={setOrdering} />)}
        </div>
      )}

      {ordering && (
        <OrderModal product={ordering} onClose={() => setOrdering(null)} onDone={() => { setOrdering(null); load(); }} />
      )}
    </div>
  );
}
