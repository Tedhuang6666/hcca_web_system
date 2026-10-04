"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { toast } from "sonner";
import { authApi, seatingApi, shopApi, apiErrorMessage } from "@/lib/api";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import type { SeatBookingOut, OrderOut, ProductOut, ZoneListItem } from "@/lib/types";
import { useWS } from "@/hooks/useWS";

type SeatingItem = {
  productId: string;
  product: ProductOut;
  quantity: number;
  zones: ZoneListItem[];
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const fromClass = useSearchParams().get("from") === "class";
  const backHref = fromClass ? "/shop/class-orders" : "/shop/orders";
  const backLabel = fromClass ? "返回議員工作台" : "返回我的登記";
  const [order, setOrder] = useState<OrderOut | null>(null);
  const [assignments, setAssignments] = useState<SeatBookingOut[]>([]);
  const [seatingItems, setSeatingItems] = useState<SeatingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRoom, setUserRoom] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentRegistrationId, setCurrentRegistrationId] = useState<string | null>(null);
  const [editableProductIds, setEditableProductIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setUserRoom(userId ? `user:${userId}` : null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, user, currentRegistrations] = await Promise.all([
        shopApi.getOrder(id),
        authApi.me().catch(() => null),
        shopApi.getCurrentRegistrations().catch(() => []),
      ]);
      setOrder(o);
      setCurrentUserId(user?.id ?? null);
      const isCurrentRegistration = currentRegistrations.some((registration) => registration.id === o.id);
      setCurrentRegistrationId(isCurrentRegistration ? o.id : null);
      seatingApi.orderAssignments(id).then((r) => setAssignments(r)).catch(() => setAssignments([]));

      const editableIds = new Set<string>();
      const registrationIsEditable = user?.id === o.user_id
        && isCurrentRegistration
        && (o.status === "pending" || o.status === "confirmed")
        && !o.is_paid
        && !o.is_class_collected;
      if (registrationIsEditable) {
        try {
          const catalog = await shopApi.catalog();
          const productCategories = new Map<string, {
            categoryId: string;
            saleEnd?: string | null;
            status: string;
          }>();
          for (const category of catalog) {
            for (const product of category.products) {
              productCategories.set(product.id, {
                categoryId: category.id,
                saleEnd: product.sale_end,
                status: product.status,
              });
            }
            for (const series of category.series) {
              for (const product of series.products) {
                productCategories.set(product.id, {
                  categoryId: category.id,
                  saleEnd: product.sale_end,
                  status: product.status,
                });
              }
            }
          }
          const categoryIds = [...new Set(
            o.items.flatMap((item) => {
              const product = productCategories.get(item.product_id);
              return product ? [product.categoryId] : [];
            }),
          )];
          const closeStatus = categoryIds.length
            ? await shopApi.getCloseStatus(categoryIds, o.class_id ?? undefined)
            : null;
          for (const item of o.items) {
            const product = productCategories.get(item.product_id);
            const categoryStatus = product && closeStatus?.statuses[product.categoryId];
            const saleStillOpen = !product?.saleEnd
              || new Date(product.saleEnd).getTime() > Date.now();
            if (
              product
              && categoryStatus
              && !categoryStatus.is_closed
              && saleStillOpen
              && (product.status === "active" || product.status === "sold_out")
            ) {
              editableIds.add(item.product_id);
            }
          }
        } catch {
          // 無法確認商品是否仍開放時，不顯示修改入口。
        }
      }
      setEditableProductIds(editableIds);

      // 找出需劃位的票種，載入其場次
      const seating: SeatingItem[] = [];
      for (const item of o.items) {
        try {
          const product = await shopApi.getProduct(item.product_id);
          if (product.requires_seating) {
            const zones = await seatingApi.listZones(item.product_id);
            seating.push({ productId: item.product_id, product, quantity: item.quantity, zones });
          }
        } catch { /* 略過讀取失敗的單一品項 */ }
      }
      setSeatingItems(seating);
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入訂單失敗"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useWS(userRoom, useCallback((message) => {
    const data = message.data as { domain?: string; order_id?: string } | undefined;
    if (message.type === "order.updated" && data?.domain === "shop" && data.order_id === id) {
      void load();
    }
  }, [id, load]));

  if (loading) {
    return <div className="shop-order-detail-page text-sm" style={{ color: "var(--text-muted)" }}>載入登記詳情…</div>;
  }
  if (!order) {
    return (
      <div className="shop-order-detail-page">
        <p>找不到這筆登記。</p>
        <Link href={backHref} className="shop-order-detail-back">
          <ArrowLeft size={16} aria-hidden="true" />{backLabel}
        </Link>
      </div>
    );
  }

  const assignedByZone = assignments.reduce<Record<string, SeatBookingOut[]>>((acc, a) => {
    (acc[a.zone_id] ||= []).push(a);
    return acc;
  }, {});
  const subtotalPrice = order.subtotal_price || order.items.reduce((sum, item) => sum + item.subtotal, 0);
  const canModifyRegistration = order.user_id === currentUserId
    && order.id === currentRegistrationId
    && (order.status === "pending" || order.status === "confirmed")
    && !order.is_paid
    && !order.is_class_collected;
  const amountDue = order.status === "cancelled" || order.status === "refunded"
    || order.is_paid || order.is_class_collected
    ? 0
    : order.total_price;

  return (
    <div className="shop-order-detail-page">
      <Link href={backHref} className="shop-order-detail-back">
        <ArrowLeft size={16} aria-hidden="true" />{backLabel}
      </Link>

      <header className="shop-order-detail-hero">
        <div>
          <h1>登記詳情</h1>
          <p className="shop-order-detail-serial">{order.serial_number}</p>
          <div className="mt-2"><OrderStatusBadge status={order.status} /></div>
          <p className="shop-order-detail-created">
            登記時間：{new Date(order.created_at).toLocaleString("zh-TW")}
          </p>
        </div>
        <dl className="shop-order-detail-total">
          <dt>登記總額</dt>
          <dd>NT${order.total_price.toLocaleString()}</dd>
        </dl>
      </header>

      <section className="shop-order-detail-panel" aria-labelledby="shop-order-payment-title">
        <h2 id="shop-order-payment-title">收款進度</h2>
        <dl className="shop-order-payment-grid">
          <div>
            <dt style={{ color: "var(--text-muted)" }}>目前尚待繳交</dt>
            <dd>NT${amountDue.toLocaleString()}</dd>
          </div>
          {order.class_id && <div>
            <dt style={{ color: "var(--text-muted)" }}>班代收款紀錄</dt>
            <dd>{order.is_class_collected ? "已收款" : "待收款"}</dd>
          </div>}
          <div>
            <dt style={{ color: "var(--text-muted)" }}>正式繳費狀態</dt>
            <dd>{order.is_paid ? "班聯會已確認" : "尚未確認"}</dd>
          </div>
        </dl>
        {canModifyRegistration && editableProductIds.size > 0 ? (
          <p className="shop-order-edit-note">
            尚未收款，可修改下方仍開放的商品。
          </p>
        ) : canModifyRegistration ? (
          <p className="shop-order-edit-note">商品截止或班級結單後，無法修改這筆登記。</p>
        ) : order.is_paid || order.is_class_collected ? (
          <p className="shop-order-edit-note">已進入收款流程，這筆登記已鎖定。</p>
        ) : null}
      </section>

      <section className="shop-order-detail-panel" aria-labelledby="shop-order-items-title">
        <h2 id="shop-order-items-title">商品明細</h2>
        <div className="shop-order-items">
        {order.items.map((it) => (
          <article key={it.id} className="shop-order-item">
            <div className="min-w-0">
              <h3>
                {it.product_name ?? it.product_id.slice(0, 8)}
              </h3>
              {it.selected_options.length > 0 && (
                <p className="shop-order-item-options">
                  {it.selected_options.map((option) => `${option.group_name}：${option.value}`).join("、")}
                </p>
              )}
              <p className="shop-order-item-unit">
                NT${it.unit_price.toLocaleString()} × {it.quantity}
              </p>
            </div>
            <div className="shrink-0">
              <p className="shop-order-item-total">NT${it.subtotal.toLocaleString()}</p>
              {canModifyRegistration && editableProductIds.has(it.product_id) && (
                <Link
                  href={`/shop?product=${encodeURIComponent(it.product_id)}`}
                  className="shop-order-edit"
                  aria-label={`修改${it.product_name ?? "商品"}登記`}>
                  <Pencil size={13} aria-hidden="true" />修改
                </Link>
              )}
            </div>
          </article>
        ))}
        </div>
        <dl className="shop-order-totals">
          <div>
            <dt>商品小計</dt>
            <dd>NT${subtotalPrice.toLocaleString()}</dd>
          </div>
          {order.applied_promotions?.length ? order.applied_promotions.map((promotion) => (
            <div key={promotion.promotion_id}>
              <dt>優惠折抵{promotion.code ? `（${promotion.code}）` : `（${promotion.name}）`}</dt>
              <dd style={{ color: promotion.discount_amount ? "var(--success)" : "var(--text-primary)" }}>
                − NT${promotion.discount_amount.toLocaleString()}
              </dd>
            </div>
          )) : (
            <div>
              <dt>優惠折抵{order.promotion_code ? `（${order.promotion_code}）` : ""}</dt>
              <dd style={{ color: order.discount_amount ? "var(--success)" : "var(--text-primary)" }}>
                − NT${order.discount_amount.toLocaleString()}
              </dd>
            </div>
          )}
          <div className="shop-order-grand-total">
            <dt>應付總額</dt>
            <dd>NT${order.total_price.toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      {order.notes && (
        <section className="shop-order-detail-panel" aria-labelledby="shop-order-note-title">
          <h2 id="shop-order-note-title">備註</h2>
          <p className="shop-order-detail-note">{order.notes}</p>
        </section>
      )}

      {/* 劃位 */}
      {seatingItems.map(({ product, quantity, zones }) => {
        const isAdminAssign = product.seating_mode === "admin_assign";
        return (
          <section key={product.id} className="shop-order-detail-panel space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="mb-0">劃位 — {product.name}</h2>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>購票 {quantity} 張</span>
            </div>

            {isAdminAssign ? (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                此票種由主辦單位依到場順序安排座位，無需自行劃位。
              </p>
            ) : zones.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>主辦單位尚未開放座位圖。</p>
            ) : (
              <div className="space-y-2">
                {zones.map((z) => {
                  const seated = assignedByZone[z.id] || [];
                  const notOpen = z.seating_opens_at && new Date(z.seating_opens_at) > new Date();
                  return (
                    <div key={z.id} className="flex items-center justify-between rounded-lg px-3 py-2"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                      <div>
                        <p className="text-sm font-medium">{z.name}</p>
                        {z.starts_at && (
                          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {new Date(z.starts_at).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}
                          </p>
                        )}
                        {seated.length > 0 && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--primary-text)" }}>
                            已劃：{seated.map((a) => a.seat_label).join(", ")}
                          </p>
                        )}
                        {notOpen && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                            開放時間 {new Date(z.seating_opens_at!).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}
                          </p>
                        )}
                      </div>
                      <Link href={`/seating/${z.id}?order_id=${order.id}`} className="btn btn-primary text-xs">
                        {seated.length > 0 ? "調整座位" : "選擇座位"}
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}

            {isAdminAssign && assignments.length > 0 && (
              <p className="text-sm" style={{ color: "var(--primary-text)" }}>
                已安排座位：{assignments.map((a) => a.seat_label).join(", ")}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
