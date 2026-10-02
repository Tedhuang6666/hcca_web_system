"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authApi, classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import type { CartOut, CartItemOut, ShopPromotionPreviewOut } from "@/lib/types";
import {
  clearGuestCart,
  getGuestCart,
  guestCartAsCartOut,
  removeGuestCartItem,
  updateGuestCartItem,
} from "@/lib/shop-guest-cart";

type CartProductGroup = {
  product_id: string;
  product_name: string;
  product_image_url: string | null;
  items: CartItemOut[];
  total: number;
};

function CartVariantRow({
  item,
  productQuantity,
  maxQuantityPerUser,
  onChangeQty,
  onRemove,
}: {
  item: CartItemOut;
  productQuantity: number;
  maxQuantityPerUser: number | null;
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
          <button
            onClick={() => onChangeQty(item.quantity + 1)}
            disabled={maxQuantityPerUser !== null && productQuantity >= maxQuantityPerUser}
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
          NT${item.unit_price.toLocaleString()} × {item.quantity}
          <span className="sr-only">，</span>
          <span className="ml-1">小計 NT${item.subtotal.toLocaleString()}</span>
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
            width={76}
            height={76}
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
          productQuantity={group.items.reduce((sum, entry) => sum + entry.quantity, 0)}
          maxQuantityPerUser={item.max_quantity_per_user ?? null}
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
  const [couponCode, setCouponCode] = useState("");
  const [promotionPreview, setPromotionPreview] = useState<ShopPromotionPreviewOut | null>(null);
  const [promotionPreviewSignature, setPromotionPreviewSignature] = useState<string | null>(null);
  const [promotionPreviewError, setPromotionPreviewError] = useState<string | null>(null);
  const [promotionPreviewLoading, setPromotionPreviewLoading] = useState(false);
  const [requestedCouponCode, setRequestedCouponCode] = useState<string | null | undefined>(undefined);
  const [paymentMethod, setPaymentMethod] = useState("cash_on_pickup");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isSchoolEmail, setIsSchoolEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closedCategoryNames, setClosedCategoryNames] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const user = await authApi.me().catch(() => null);
      setIsLoggedIn(Boolean(user));
      setIsSchoolEmail(Boolean(user?.is_school_email));
      setRequestedCouponCode(user ? null : undefined);
      setPromotionPreview(null);
      setPromotionPreviewSignature(null);
      if (user) {
        const guestItems = getGuestCart();
        for (const item of guestItems) {
          await shopApi.addCartItem({
            product_id: item.product_id,
            quantity: item.quantity,
            option_ids: item.selected_options.map((option) => option.option_id),
          });
        }
        if (guestItems.length) clearGuestCart();
      }
      const cartData = user ? await shopApi.getCart() : guestCartAsCartOut();
      setCart(cartData);
      // best-effort 結單檢查
      if (cartData.items.length) {
        const [catalog, schoolClass] = await Promise.all([
          shopApi.catalog().catch(() => []),
          user ? classApi.myClass().catch(() => null) : Promise.resolve(null),
        ]);
        if (schoolClass && catalog.length) {
          const productCatMap = new Map<string, string>();
          const catNameMap = new Map<string, string>();
          for (const cat of catalog) {
            catNameMap.set(cat.id, cat.name);
            for (const product of cat.products)
              productCatMap.set(product.id, cat.id);
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

  const cartSignature = (cart?.items ?? [])
    .map((item) => `${item.id}:${item.product_id}:${item.quantity}:${item.unit_price}:${item.available}`)
    .join("|");

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isLoggedIn || !cart || requestedCouponCode === undefined) {
      setPromotionPreview(null);
      setPromotionPreviewSignature(null);
      setPromotionPreviewError(null);
      setPromotionPreviewLoading(false);
      return;
    }
    let active = true;
    setPromotionPreviewLoading(true);
    setPromotionPreviewError(null);
    shopApi
      .previewPromotion(requestedCouponCode === null ? undefined : { code: requestedCouponCode })
      .then((preview) => {
        if (!active) return;
        setPromotionPreview(preview);
        setPromotionPreviewSignature(cartSignature);
      })
      .catch((error) => {
        if (!active) return;
        setPromotionPreview(null);
        setPromotionPreviewSignature(null);
        setPromotionPreviewError(apiErrorMessage(error, "無法檢查優惠碼，請稍後重試。"));
      })
      .finally(() => {
        if (active) setPromotionPreviewLoading(false);
      });
    return () => { active = false; };
  }, [cart, cartSignature, isLoggedIn, requestedCouponCode]);

  const changeQty = async (itemId: string, qty: number) => {
    const target = cart?.items.find((item) => item.id === itemId);
    if (target?.max_quantity_per_user != null && cart) {
      const otherQuantity = cart.items
        .filter((item) => item.product_id === target.product_id && item.id !== itemId)
        .reduce((total, item) => total + item.quantity, 0);
      if (otherQuantity + qty > target.max_quantity_per_user) {
        toast.error(`此商品每人限購 ${target.max_quantity_per_user} 件`);
        return;
      }
    }
    if (!isLoggedIn) {
      const nextItems = updateGuestCartItem(itemId, qty);
      setCart({
        ...cart!,
        items: nextItems,
        total_price: nextItems.reduce((sum, item) => sum + (item.available ? item.subtotal : 0), 0),
      });
      return;
    }
    try {
      setCart(await shopApi.updateCartItem(itemId, qty));
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
    }
  };

  const remove = async (itemId: string) => {
    if (!isLoggedIn) {
      const nextItems = removeGuestCartItem(itemId);
      setCart({ ...cart!, items: nextItems, total_price: nextItems.reduce((sum, item) => sum + (item.available ? item.subtotal : 0), 0) });
      return;
    }
    try {
      setCart(await shopApi.removeCartItem(itemId));
    } catch (e) {
      toast.error(apiErrorMessage(e, "移除失敗"));
    }
  };

  const checkout = async () => {
    if (!isLoggedIn) {
      router.push("/login?next=%2Fshop%2Fcart");
      return;
    }
    const enteredCode = couponCode.trim();
    if (enteredCode && (
      requestedCouponCode !== enteredCode
      || promotionPreviewSignature !== cartSignature
      || promotionPreviewLoading
      || !promotionPreview?.eligible
    )) {
      toast.error("請先檢查優惠碼；若不符合資格，請移除優惠碼後再送單。");
      return;
    }
    setSubmitting(true);
    try {
      const orders = await shopApi.checkout({
        notes: notes || undefined,
        coupon_code: enteredCode || undefined,
        payment_method: isSchoolEmail ? undefined : paymentMethod,
      });
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
  const currentPreview = promotionPreviewSignature === cartSignature ? promotionPreview : null;
  const displayedSubtotal = currentPreview?.subtotal_price ?? cart?.total_price ?? 0;
  const displayedDiscount = currentPreview?.eligible ? currentPreview.discount_amount : 0;
  const displayedTotal = currentPreview?.eligible
    ? currentPreview.total_price
    : cart?.total_price ?? 0;
  const enteredCouponCode = couponCode.trim();
  const couponBlocksCheckout = Boolean(enteredCouponCode) && (
    requestedCouponCode !== enteredCouponCode
    || promotionPreviewSignature !== cartSignature
    || promotionPreviewLoading
    || !promotionPreview?.eligible
  );

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
            <div className="space-y-4">
              <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-secondary)" }}>
                備註（選填）
              </label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="特殊需求…"
                className="input w-full"
              />
              {isLoggedIn ? (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      優惠碼（選填）
                    </span>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={couponCode}
                        onChange={(e) => {
                          const nextCode = e.target.value.toUpperCase();
                          setCouponCode(nextCode);
                          setPromotionPreview(null);
                          setPromotionPreviewSignature(null);
                          setPromotionPreviewError(null);
                          setRequestedCouponCode(nextCode.trim() ? undefined : null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            if (enteredCouponCode) setRequestedCouponCode(enteredCouponCode);
                          }
                        }}
                        placeholder="輸入優惠碼"
                        className="input w-full min-w-0 flex-1"
                        autoCapitalize="characters"
                        aria-describedby="coupon-help"
                      />
                      <button
                        type="button"
                        onClick={() => setRequestedCouponCode(enteredCouponCode || null)}
                        disabled={promotionPreviewLoading || !enteredCouponCode}
                        className="btn btn-ghost min-h-11 sm:shrink-0"
                        aria-busy={promotionPreviewLoading}>
                        {promotionPreviewLoading ? "檢查中…" : "檢查優惠碼"}
                      </button>
                    </div>
                    <span id="coupon-help" className="mt-1.5 block text-xs" style={{ color: "var(--text-muted)" }}>
                      {enteredCouponCode
                        ? "檢查後會顯示資格、可省金額與折後總額。"
                        : "帳號符合自動優惠時，系統會在此顯示折扣。"}
                    </span>
                  </label>
                  {promotionPreviewError && (
                    <p role="alert" className="text-sm" style={{ color: "var(--danger, #e11d48)" }}>
                      {promotionPreviewError}
                    </p>
                  )}
                  {currentPreview && currentPreview.reason_code !== "no_promotion" && (
                    <div
                      role={currentPreview.eligible ? "status" : "alert"}
                      className="rounded-lg px-4 py-3 space-y-2"
                      style={{
                        border: `1px solid ${currentPreview.eligible ? "var(--success-border)" : "var(--danger-border, #fecaca)"}`,
                        background: currentPreview.eligible ? "var(--success-dim)" : "var(--danger-dim, #fff1f2)",
                        color: currentPreview.eligible ? "var(--success)" : "var(--danger, #be123c)",
                      }}>
                      <p className="font-semibold">
                        {currentPreview.eligible ? "優惠已套用" : "目前無法使用此優惠"}
                        {currentPreview.promotion_name ? `：${currentPreview.promotion_name}` : ""}
                      </p>
                      {currentPreview.reason && <p className="text-sm">{currentPreview.reason}</p>}
                      <dl className="space-y-1 text-sm">
                        <div className="flex justify-between gap-4">
                          <dt>商品小計</dt>
                          <dd>NT${currentPreview.subtotal_price.toLocaleString()}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt>優惠折抵</dt>
                          <dd>− NT${currentPreview.discount_amount.toLocaleString()}</dd>
                        </div>
                        <div className="flex justify-between gap-4 border-t pt-1 font-bold" style={{ borderColor: "currentColor" }}>
                          <dt>折後總額</dt>
                          <dd>NT${currentPreview.total_price.toLocaleString()}</dd>
                        </div>
                      </dl>
                    </div>
                  )}
                  {isSchoolEmail ? (
                    <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: "var(--success-dim)", border: "1px solid var(--success-border)", color: "var(--success)" }}>
                      校務信箱已確認身分，訂單會沿用校內收款流程，不需要選擇付款方式。
                    </div>
                  ) : (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                        付款方式
                      </span>
                      <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="input w-full">
                        <option value="cash_on_pickup">取貨時付款</option>
                        <option value="bank_transfer">銀行轉帳</option>
                      </select>
                    </label>
                  )}
                </>
              ) : (
                <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: "var(--primary-dim)", border: "1px solid var(--border)", color: "var(--primary-text)" }}>
                  結帳時才需要登入；購物車內容會保留。登入後系統會依帳號套用可用優惠。
                </div>
              )}
            </div>
            <div className="space-y-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--text-secondary)" }}>商品小計</span>
                <span style={{ color: "var(--text-primary)" }}>NT${displayedSubtotal.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--text-secondary)" }}>優惠折抵</span>
                <span style={{ color: displayedDiscount ? "var(--success)" : "var(--text-secondary)" }}>
                  − NT${displayedDiscount.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between border-t pt-2">
                <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>應付總額</span>
                <span className="text-xl font-bold" style={{ color: "var(--primary)" }}>
                  NT${displayedTotal.toLocaleString()}
                </span>
              </div>
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
              disabled={submitting || (cart?.total_price ?? 0) === 0 || closedCategoryNames.length > 0 || couponBlocksCheckout}
              className="btn w-full"
              style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}
              aria-busy={submitting}>
              {submitting ? "送單中…" : isLoggedIn ? "送出訂單" : "登入後結帳"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
