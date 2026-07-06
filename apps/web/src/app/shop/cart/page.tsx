"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import type { CartOut, CartItemOut } from "@/lib/types";

type CartProductGroup = {
  product_id: string;
  product_name: string;
  product_image_url: string | null;
  items: CartItemOut[];
  total: number;
};

function CartVariantRow({
  item,
  onChangeQty,
  onRemove,
}: {
  item: CartItemOut;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-[1fr_auto]"
      style={{ opacity: item.available ? 1 : 0.6, borderTop: "1px solid var(--border)" }}>
      <div className="flex-1 min-w-0">
        {item.selected_options.length > 0 && (
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {item.selected_options.map((o) => `${o.group_name}：${o.value}`).join("　")}
          </p>
        )}
        {item.selected_options.length === 0 && (
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>標準品項</p>
        )}
        {!item.available && item.unavailable_reason && (
          <p className="text-xs mt-1" style={{ color: "var(--danger, #e11d48)" }}>
            {item.unavailable_reason}
          </p>
        )}
        <div className="flex items-center gap-3 mt-2">
          <button onClick={() => onChangeQty(Math.max(1, item.quantity - 1))}
            className="btn btn-ghost w-7 h-7 p-0" aria-label="減少">−</button>
          <span className="text-sm font-semibold w-6 text-center" style={{ color: "var(--text-primary)" }}>
            {item.quantity}
          </span>
          <button onClick={() => onChangeQty(item.quantity + 1)}
            className="btn btn-ghost w-7 h-7 p-0" aria-label="增加">＋</button>
          <button onClick={onRemove} className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>
            移除
          </button>
        </div>
      </div>
      <div className="text-left sm:text-right flex-shrink-0">
        <p className="font-bold" style={{ color: "var(--primary)" }}>
          NT${item.subtotal.toLocaleString()}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          單價 {item.unit_price.toLocaleString()}
        </p>
      </div>
    </div>
  );
}

function CartProductCard({
  group,
  onChangeQty,
  onRemove,
}: {
  group: CartProductGroup;
  onChangeQty: (itemId: string, qty: number) => void;
  onRemove: (itemId: string) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex gap-4 p-4">
        {group.product_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={uploadUrl(group.product_image_url)}
            alt={group.product_name}
            className="rounded-lg object-cover flex-shrink-0"
            style={{ width: 76, height: 76, border: "1px solid var(--border)" }}
          />
        ) : (
          <div
            className="rounded-lg flex-shrink-0"
            style={{ width: 76, height: 76, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            aria-hidden="true"
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-base truncate" style={{ color: "var(--text-primary)" }}>
            {group.product_name}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {group.items.length} 種規格 · {group.items.reduce((sum, item) => sum + item.quantity, 0)} 件
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>小計</p>
          <p className="font-bold" style={{ color: "var(--primary)" }}>
            NT${group.total.toLocaleString()}
          </p>
        </div>
      </div>
      {group.items.map((item) => (
        <CartVariantRow
          key={item.id}
          item={item}
          onChangeQty={(qty) => onChangeQty(item.id, qty)}
          onRemove={() => onRemove(item.id)}
        />
      ))}
    </div>
  );
}

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [closedCategoryNames, setClosedCategoryNames] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cartData = await shopApi.getCart();
      setCart(cartData);
      // best-effort 結單檢查
      if (cartData.items.length) {
        const [catalog, schoolClass] = await Promise.all([
          shopApi.catalog().catch(() => []),
          classApi.myClass().catch(() => null),
        ]);
        if (schoolClass && catalog.length) {
          const productCatMap = new Map<string, string>();
          const catNameMap = new Map<string, string>();
          for (const cat of catalog) {
            catNameMap.set(cat.id, cat.name);
            for (const s of cat.series)
              for (const p of s.products)
                productCatMap.set(p.id, cat.id);
          }
          const catIds = [...new Set(
            cartData.items.map((i) => productCatMap.get(i.product_id)).filter(Boolean) as string[]
          )];
          if (catIds.length) {
            const status = await shopApi.getCloseStatus(catIds, schoolClass.id).catch(() => null);
            if (status) {
              setClosedCategoryNames(
                catIds.filter((id) => status.statuses[id]?.is_closed).map((id) => catNameMap.get(id) ?? id)
              );
            }
          }
        }
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入失敗"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeQty = async (itemId: string, qty: number) => {
    try {
      setCart(await shopApi.updateCartItem(itemId, qty));
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
    }
  };

  const remove = async (itemId: string) => {
    try {
      setCart(await shopApi.removeCartItem(itemId));
    } catch (e) {
      toast.error(apiErrorMessage(e, "移除失敗"));
    }
  };

  const checkout = async () => {
    setSubmitting(true);
    try {
      const orders = await shopApi.checkout(notes || undefined);
      toast.success(`送單成功，共 ${orders.length} 張訂單`);
      router.push("/shop/orders");
    } catch (e) {
      toast.error(apiErrorMessage(e, "送單失敗"));
    } finally {
      setSubmitting(false);
    }
  };

  const items = cart?.items ?? [];
  const groupedItems: CartProductGroup[] = Array.from(
    items.reduce((map, item) => {
      const current = map.get(item.product_id);
      if (current) {
        current.items.push(item);
        current.total += item.available ? item.subtotal : 0;
      } else {
        map.set(item.product_id, {
          product_id: item.product_id,
          product_name: item.product_name,
          product_image_url: item.product_image_url ?? null,
          items: [item],
          total: item.available ? item.subtotal : 0,
        });
      }
      return map;
    }, new Map<string, CartProductGroup>()).values()
  );
  const hasUnavailable = items.some((i) => !i.available);

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>購物車</h1>
        <Link href="/shop" className="btn btn-ghost">繼續選購</Link>
      </div>

      {loading ? (
        <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>
          <p className="text-sm">載入中…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>
          <p className="text-sm">購物車是空的</p>
          <Link href="/shop" className="btn btn-ghost mt-4 inline-flex">去選購</Link>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {groupedItems.map((group) => (
              <CartProductCard
                key={group.product_id}
                group={group}
                onChangeQty={changeQty}
                onRemove={remove}
              />
            ))}
          </div>

          <div className="card p-5 space-y-4">
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-secondary)" }}>
                備註（選填）
              </label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="特殊需求…"
                className="input w-full"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                可結算金額
              </span>
              <span className="text-xl font-bold" style={{ color: "var(--primary)" }}>
                NT${(cart?.total_price ?? 0).toLocaleString()}
              </span>
            </div>
            {hasUnavailable && (
              <p className="text-xs" style={{ color: "var(--danger, #e11d48)" }}>
                部分商品已無法購買，請先調整數量或移除後再送單。
              </p>
            )}
            {closedCategoryNames.length > 0 && (
              <div className="rounded-lg px-4 py-3 text-xs" style={{
                border: "1px solid rgba(239,68,68,0.3)",
                background: "rgba(239,68,68,0.06)",
                color: "#b91c1c",
              }}>
                <strong>您的班級已結單</strong>（{closedCategoryNames.join("、")}），購物車中有該分類商品，無法送單。請聯繫班級幹部。
              </div>
            )}
            <button
              onClick={checkout}
              disabled={submitting || (cart?.total_price ?? 0) === 0 || closedCategoryNames.length > 0}
              className="btn w-full"
              style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}
              aria-busy={submitting}>
              {submitting ? "送單中…" : "送出訂單"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
