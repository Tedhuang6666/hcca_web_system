"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { authApi, seatingApi, shopApi, apiErrorMessage } from "@/lib/api";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import type { SeatBookingOut, OrderListItem, OrderOut, ProductOut, ZoneListItem } from "@/lib/types";
import { useWS } from "@/hooks/useWS";
import { groupActivityPreorders } from "@/lib/shop-preorders";

type SeatingItem = {
  productId: string;
  product: ProductOut;
  quantity: number;
  zones: ZoneListItem[];
  sources: {
    orderId: string;
    quantity: number;
    assignments: SeatBookingOut[];
  }[];
};

type ActivityPreorder = ReturnType<typeof groupActivityPreorders>[number];

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const from = useSearchParams().get("from");
  const fromClass = from === "class";
  const fromCouncil = from === "council";
  const loginNext = fromClass ? `/shop/orders/${id}?from=class`
    : fromCouncil ? `/shop/orders/${id}?from=council`
      : `/shop/orders/${id}`;
  const loginHref = `/login?next=${encodeURIComponent(loginNext)}`;
  const backHref = fromClass ? "/shop/class-orders"
    : fromCouncil ? "/shop/council-orders" : "/shop/orders";
  const backLabel = fromClass ? "返回班代收款"
    : fromCouncil ? "返回全校訂單" : "返回我的預購";
  const [order, setOrder] = useState<OrderOut | null>(null);
  const [orders, setOrders] = useState<OrderOut[]>([]);
  const [activityPreorder, setActivityPreorder] = useState<ActivityPreorder | null>(null);
  const [seatingItems, setSeatingItems] = useState<SeatingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [requiresLogin, setRequiresLogin] = useState(false);
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
    setLoadError("");
    setRequiresLogin(false);
    try {
      const user = await authApi.me().catch(() => null);
      if (!user) {
        setRequiresLogin(true);
        setOrder(null);
        setOrders([]);
        return;
      }

      const o = await shopApi.getOrder(id);
      setOrder(o);
      setCurrentUserId(user.id);

      let summary: ActivityPreorder | null = null;
      if (!fromClass && !fromCouncil && user.id === o.user_id) {
        const allOrders: OrderListItem[] = [];
        for (let offset = 0; ; offset += 500) {
          const page = await shopApi.listOrders({
            limit: "500",
            offset: String(offset),
            my_only: "true",
          });
          allOrders.push(...page);
          if (page.length < 500) break;
        }
        summary = groupActivityPreorders(allOrders)
          .find((group) => group.orders.some((candidate) => candidate.id === o.id)) ?? null;
      }

      const relatedOrderIds = summary?.orders.map((related) => related.id) ?? [o.id];
      const [relatedOrders, currentRegistrations] = await Promise.all([
        Promise.all(relatedOrderIds.map((relatedId) =>
          relatedId === o.id ? Promise.resolve(o) : shopApi.getOrder(relatedId),
        )),
        shopApi.getCurrentRegistrations().catch(() => []),
      ]);
      setOrders(relatedOrders);
      setActivityPreorder(summary);
      const currentRegistration = currentRegistrations.find((registration) =>
        relatedOrderIds.includes(registration.id),
      );
      setCurrentRegistrationId(currentRegistration?.id ?? null);

      const editableIds = new Set<string>();
      const registrationIsEditable = currentRegistration?.user_id === user.id
        && (currentRegistration.status === "pending" || currentRegistration.status === "confirmed")
        && !currentRegistration.is_paid
        && !currentRegistration.is_class_collected;
      if (registrationIsEditable && currentRegistration) {
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
            currentRegistration.items.flatMap((item) => {
              const product = productCategories.get(item.product_id);
              return product ? [product.categoryId] : [];
            }),
          )];
          const closeStatus = categoryIds.length
            ? await shopApi.getCloseStatus(categoryIds, currentRegistration.class_id ?? undefined)
            : null;
          for (const item of currentRegistration.items) {
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

      const assignmentsByOrder = new Map<string, SeatBookingOut[]>();
      await Promise.all(relatedOrders.map(async (relatedOrder) => {
        assignmentsByOrder.set(
          relatedOrder.id,
          await seatingApi.orderAssignments(relatedOrder.id).catch(() => []),
        );
      }));

      const quantitiesByProduct = new Map<string, Map<string, number>>();
      for (const relatedOrder of relatedOrders) {
        for (const item of relatedOrder.items) {
          const sources = quantitiesByProduct.get(item.product_id) ?? new Map<string, number>();
          sources.set(relatedOrder.id, (sources.get(relatedOrder.id) ?? 0) + item.quantity);
          quantitiesByProduct.set(item.product_id, sources);
        }
      }

      const seating = await Promise.all([...quantitiesByProduct.entries()].map(async ([productId, sources]) => {
        try {
          const product = await shopApi.getProduct(productId);
          if (!product.requires_seating) return null;
          const zones = await seatingApi.listZones(productId);
          const zoneIds = new Set(zones.map((zone) => zone.id));
          return {
            productId,
            product,
            quantity: [...sources.values()].reduce((sum, quantity) => sum + quantity, 0),
            zones,
            sources: [...sources.entries()].map(([orderId, quantity]) => ({
              orderId,
              quantity,
              assignments: (assignmentsByOrder.get(orderId) ?? [])
                .filter((assignment) => zoneIds.has(assignment.zone_id)),
            })),
          } satisfies SeatingItem;
        } catch {
          return null;
        }
      }));
      setSeatingItems(seating.filter((item): item is SeatingItem => item !== null));
    } catch (e) {
      setOrder(null);
      setOrders([]);
      setLoadError(apiErrorMessage(e, "載入訂單失敗"));
    } finally {
      setLoading(false);
    }
  }, [fromClass, fromCouncil, id]);

  useEffect(() => { load(); }, [load]);

  useWS(userRoom, useCallback((message) => {
    const data = message.data as { domain?: string; order_id?: string } | undefined;
    if (message.type === "order.updated" && data?.domain === "shop"
      && orders.some((relatedOrder) => relatedOrder.id === data.order_id)) {
      void load();
    }
  }, [load, orders]));

  if (loading) {
    return <div className="shop-order-detail-page text-sm" style={{ color: "var(--text-muted)" }}>載入登記詳情…</div>;
  }
  if (requiresLogin) {
    return (
      <div className="shop-order-detail-page">
        <h1>登入後查看預購</h1>
        <p>預購明細僅供訂購者或具備管理權限的人員查看。</p>
        <div className="flex flex-wrap gap-3">
          <Link href={loginHref} className="btn btn-primary">登入</Link>
          <Link href="/shop" className="shop-order-detail-back">返回商品頁</Link>
        </div>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="shop-order-detail-page">
        {loadError ? <p role="alert">{loadError}</p> : <p>找不到這筆預購，或目前帳號無法查看。</p>}
        {loadError && <button type="button" className="shop-order-edit" onClick={() => void load()}>重新載入</button>}
        <Link href={backHref} className="shop-order-detail-back">
          <ArrowLeft size={16} aria-hidden="true" />{backLabel}
        </Link>
      </div>
    );
  }

  const detailOrders = orders.length > 0 ? orders : [order];
  const isGrouped = detailOrders.length > 1;
  const itemsToDisplay = activityPreorder?.items ?? order.items;
  const detailTotal = activityPreorder?.amount ?? order.total_price;
  const subtotalPrice = activityPreorder
    ? detailOrders.reduce((sum, relatedOrder) => sum + relatedOrder.subtotal_price, 0)
    : order.subtotal_price || order.items.reduce((sum, item) => sum + item.subtotal, 0);
  const discountAmount = activityPreorder
    ? detailOrders.reduce((sum, relatedOrder) => sum + relatedOrder.discount_amount, 0)
    : order.discount_amount;
  const receivedAmount = activityPreorder?.received
    ?? (order.is_paid || (order.class_id && order.is_class_collected) ? order.total_price : 0);
  const amountDue = activityPreorder?.outstanding
    ?? (order.status === "cancelled" || order.status === "refunded"
      || order.is_paid || order.is_class_collected ? 0 : order.total_price);
  const currentRegistration = detailOrders.find((relatedOrder) => relatedOrder.id === currentRegistrationId);
  const canModifyRegistration = currentRegistration?.user_id === currentUserId
    && (currentRegistration.status === "pending" || currentRegistration.status === "confirmed")
    && !currentRegistration.is_paid
    && !currentRegistration.is_class_collected;
  const classOrders = detailOrders.filter((relatedOrder) => relatedOrder.class_id);
  const collectedClassOrders = classOrders.filter((relatedOrder) => relatedOrder.is_class_collected);
  const paidOrders = detailOrders.filter((relatedOrder) => relatedOrder.is_paid);
  const notes = [...new Set(detailOrders.flatMap((relatedOrder) => {
    const note = relatedOrder.notes?.trim();
    return note ? [note] : [];
  }))];
  const createdAt = detailOrders.reduce((earliest, relatedOrder) =>
    relatedOrder.created_at < earliest ? relatedOrder.created_at : earliest,
  detailOrders[0].created_at);

  return (
    <div className="shop-order-detail-page">
      <Link href={backHref} className="shop-order-detail-back">
        <ArrowLeft size={16} aria-hidden="true" />{backLabel}
      </Link>

      <header className="shop-order-detail-hero">
        <div>
          <h1>{activityPreorder?.label ?? order.activity_name ?? (order.activity_id ? "活動預購" : "一般商品預購")}</h1>
          {isGrouped ? (
            <p className="shop-order-detail-serial">活動預購詳情</p>
          ) : (
            <>
              <p className="shop-order-detail-serial">訂單 {order.serial_number}</p>
              <div className="mt-2"><OrderStatusBadge status={order.status} /></div>
            </>
          )}
          <p className="shop-order-detail-created">
            {isGrouped ? "最早預購時間：" : "登記時間："}{new Date(createdAt).toLocaleString("zh-TW")}
          </p>
        </div>
        <dl className="shop-order-detail-total">
          <dt>{isGrouped ? "活動預購總額" : "預購總額"}</dt>
          <dd>NT${detailTotal.toLocaleString()}</dd>
        </dl>
      </header>

      <section className="shop-order-detail-panel" aria-labelledby="shop-order-payment-title">
        <h2 id="shop-order-payment-title">收款進度</h2>
        <dl className="shop-order-payment-grid">
          <div>
            <dt style={{ color: "var(--text-muted)" }}>目前尚待繳交</dt>
            <dd>NT${amountDue.toLocaleString()}</dd>
          </div>
          {activityPreorder && <div>
            <dt style={{ color: "var(--text-muted)" }}>已繳金額</dt>
            <dd>NT${receivedAmount.toLocaleString()}</dd>
          </div>}
          {classOrders.length > 0 && <div>
            <dt style={{ color: "var(--text-muted)" }}>班代收款紀錄</dt>
            <dd>{collectedClassOrders.length === classOrders.length ? "已收款"
              : collectedClassOrders.length > 0 ? "部分收款" : "待收款"}</dd>
          </div>}
          <div>
            <dt style={{ color: "var(--text-muted)" }}>正式繳費狀態</dt>
            <dd>{paidOrders.length === detailOrders.length ? "班聯會已確認"
              : paidOrders.length > 0 ? "部分款項已確認" : "尚未確認"}</dd>
          </div>
        </dl>
        {canModifyRegistration && editableProductIds.size > 0 ? (
          <p className="shop-order-edit-note">
            尚未收款，可修改下方仍開放的商品。
          </p>
        ) : canModifyRegistration ? (
          <p className="shop-order-edit-note">商品截止或班級結單後，無法修改這筆登記。</p>
        ) : detailOrders.some((relatedOrder) => relatedOrder.is_paid || relatedOrder.is_class_collected) ? (
          <p className="shop-order-edit-note">已進入收款流程，已收款品項無法修改。</p>
        ) : null}
      </section>

      <section className="shop-order-detail-panel" aria-labelledby="shop-order-items-title">
        <h2 id="shop-order-items-title">商品明細</h2>
        <div className="shop-order-items">
        {itemsToDisplay.map((it) => (
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
          {isGrouped ? (
            <div>
              <dt>優惠折抵</dt>
              <dd style={{ color: discountAmount ? "var(--success)" : "var(--text-primary)" }}>
                − NT${discountAmount.toLocaleString()}
              </dd>
            </div>
          ) : order.applied_promotions?.length ? order.applied_promotions.map((promotion) => (
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
            <dd>NT${detailTotal.toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      {notes.length > 0 && (
        <section className="shop-order-detail-panel" aria-labelledby="shop-order-note-title">
          <h2 id="shop-order-note-title">備註</h2>
          {notes.map((note) => <p key={note} className="shop-order-detail-note">{note}</p>)}
        </section>
      )}

      {/* 劃位 */}
      {seatingItems.map(({ product, quantity, zones, sources }) => {
        const isAdminAssign = product.seating_mode === "admin_assign";
        const assignments = sources.flatMap((source) => source.assignments);
        const assignedByZone = assignments.reduce<Record<string, SeatBookingOut[]>>((acc, assignment) => {
          (acc[assignment.zone_id] ||= []).push(assignment);
          return acc;
        }, {});
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
                      <div className="flex flex-wrap gap-2">
                        {sources.map((source) => (
                          <Link
                            key={`${z.id}:${source.orderId}`}
                            href={`/seating/${z.id}?order_id=${source.orderId}`}
                            className="btn btn-primary text-xs"
                          >
                            {source.assignments.some((assignment) => assignment.zone_id === z.id)
                              ? "調整座位" : "選擇座位"}（{source.quantity} 張）
                          </Link>
                        ))}
                      </div>
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
