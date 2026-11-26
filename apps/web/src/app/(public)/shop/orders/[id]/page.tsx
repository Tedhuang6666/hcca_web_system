"use client";
import ShopPrice from "@/components/shop/ShopPrice";
import OrderPromotionSummary from "@/components/shop/OrderPromotionSummary";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { authApi, shopApi, apiErrorMessage } from "@/lib/api";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import type { OrderListItem, OrderOut } from "@/lib/types";
import { useWS } from "@/hooks/useWS";
import { groupCategoryPreorders } from "@/lib/shop-preorders";
import { refreshAutomaticRegistrationPromotions } from "@/lib/shop-registration-promotions";
import OrderItemSources from "@/components/shop/OrderItemSources";
import ProductThumbnail from "@/components/shop/ProductThumbnail";
import OrderItemGiftBreakdown from "@/components/shop/OrderItemGiftBreakdown";

type CategoryPreorder = ReturnType<typeof groupCategoryPreorders>[number];

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const fromClass = from === "class";
  const fromCouncil = from === "council";
  const categoryView = searchParams.get("view") === "category" && !fromClass && !fromCouncil;
  const loginNext = fromClass ? `/shop/orders/${id}?from=class`
    : fromCouncil ? `/shop/orders/${id}?from=council`
      : categoryView ? `/shop/orders/${id}?view=category`
      : `/shop/orders/${id}`;
  const loginHref = `/login?next=${encodeURIComponent(loginNext)}`;
  const backHref = fromClass ? "/shop/class-orders"
    : fromCouncil ? "/shop/council-orders" : "/shop/orders";
  const backLabel = fromClass ? "返回班代收款"
    : fromCouncil ? "返回全校訂單" : "返回我的預購";
  const [order, setOrder] = useState<OrderOut | null>(null);
  const [orders, setOrders] = useState<OrderOut[]>([]);
  const [categoryPreorder, setCategoryPreorder] = useState<CategoryPreorder | null>(null);
  const [productImages, setProductImages] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [userRoom, setUserRoom] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentRegistrationId, setCurrentRegistrationId] = useState<string | null>(null);
  const [editableProductIds, setEditableProductIds] = useState<Set<string>>(new Set());
  const [delegatedEditableItemIds, setDelegatedEditableItemIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setUserRoom(userId ? `user:${userId}` : null);
  }, []);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setLoadError("");
    setRequiresLogin(false);
    if (!background) {
      setProductImages({});
      setDelegatedEditableItemIds(new Set());
    }
    try {
      const user = await authApi.me().catch(() => null);
      if (!user) {
        setRequiresLogin(true);
        setOrder(null);
        setOrders([]);
        return;
      }

      const [o, delegatedOrders] = await Promise.all([
        shopApi.getOrder(id),
        shopApi.listDelegatedOrders({ order_id: id, limit: "1" }).catch(() => []),
      ]);
      setOrder(o);
      setCurrentUserId(user.id);
      const delegatedOrder = delegatedOrders.find((entry) => entry.order.id === o.id) ?? null;
      const delegatedItemIds = new Set(delegatedOrder?.editable_item_ids ?? []);
      setDelegatedEditableItemIds(delegatedItemIds);

      let summary: CategoryPreorder | null = null;
      // A single order URL always shows its saved amount, regardless of who opens it.
      // Only the explicit category entry combines registrations in this category.
      if (categoryView && user.id === o.user_id) {
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
        summary = groupCategoryPreorders(allOrders)
          .find((group) => group.orders.some((candidate) => candidate.id === o.id)) ?? null;
      }

      const relatedOrderIds = summary?.orders.map((related) => related.id) ?? [o.id];
      const [savedRelatedOrders, currentRegistrations] = await Promise.all([
        Promise.all(relatedOrderIds.map((relatedId) =>
          relatedId === o.id ? Promise.resolve(o) : shopApi.getOrder(relatedId),
        )),
        shopApi.getCurrentRegistrations().catch(() => []),
      ]);
      const currentOrders = categoryView
        ? savedRelatedOrders.filter((related) => related.user_id === user.id
          && currentRegistrations.some((registration) => registration.id === related.id))
        : [];
      const refreshed = await refreshAutomaticRegistrationPromotions(currentOrders);
      const relatedOrders = savedRelatedOrders.map((related) =>
        refreshed.find((updated) => updated.id === related.id) ?? related);
      setOrder(relatedOrders.find((related) => related.id === o.id) ?? o);
      if (summary) {
        summary = groupCategoryPreorders(summary.orders.map((related) => ({
          ...related,
          ...relatedOrders.find((updated) => updated.id === related.id),
        })))[0] ?? null;
      }
      setOrders(relatedOrders);
      setCategoryPreorder(summary);
      const currentRegistration = currentRegistrations.find((registration) =>
        relatedOrderIds.includes(registration.id) && !registration.is_paid && !registration.is_class_collected,
      ) ?? currentRegistrations.find((registration) =>
        relatedOrderIds.includes(registration.id),
      ) ?? delegatedOrder?.order;
      setCurrentRegistrationId(currentRegistration?.id ?? null);

      const editableIds = new Set<string>();
      const isOwner = currentRegistration?.user_id === user.id;
      const registrationIsEditable = Boolean(currentRegistration
        && (currentRegistration.status === "pending" || currentRegistration.status === "confirmed")
        && !currentRegistration.is_paid
        && !currentRegistration.is_class_collected
        && (isOwner || delegatedItemIds.size > 0));
      if (registrationIsEditable && currentRegistration) {
        try {
          const itemsToCheck = delegatedOrder
            ? (currentRegistration.items ?? []).filter((item) => delegatedItemIds.has(item.id))
            : currentRegistration.items ?? [];
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
            itemsToCheck.flatMap((item) => {
              const product = productCategories.get(item.product_id);
              return product ? [product.categoryId] : [];
            }),
          )];
          const closeStatus = categoryIds.length
            ? await shopApi.getCloseStatus(categoryIds, currentRegistration.class_id ?? undefined)
            : null;
          for (const item of itemsToCheck) {
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

      const productIds = new Set(
        relatedOrders.flatMap((relatedOrder) => relatedOrder.items.map((item) => item.product_id)),
      );
      const imageUrls = new Map<string, string | null>();
      await Promise.all([...productIds].map(async (productId) => {
        try {
          const product = await shopApi.getProduct(productId);
          imageUrls.set(productId, product.image_url || product.media[0]?.image_url || null);
        } catch {
          // 商品圖片只是輔助資訊，讀取失敗時沿用預設縮圖。
        }
      }));
      setProductImages(Object.fromEntries(imageUrls));
    } catch (e) {
      setOrder(null);
      setOrders([]);
      setLoadError(apiErrorMessage(e, "載入訂單失敗"));
    } finally {
      setLoading(false);
    }
  }, [categoryView, id]);

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
  const itemsToDisplay = categoryPreorder?.items ?? order.items;
  const detailTotal = categoryPreorder?.amount ?? order.total_price;
  const subtotalPrice = categoryPreorder
    ? detailOrders.reduce((sum, relatedOrder) => sum + relatedOrder.subtotal_price, 0)
    : order.subtotal_price || order.items.reduce((sum, item) => sum + item.subtotal, 0);
  const receivedAmount = categoryPreorder?.received
    ?? (order.is_paid || (order.class_id && order.is_class_collected) ? order.total_price : 0);
  const amountDue = categoryPreorder?.outstanding
    ?? (order.status === "cancelled" || order.status === "refunded"
      || order.is_paid || order.is_class_collected ? 0 : order.total_price);
  const currentRegistration = detailOrders.find((relatedOrder) => relatedOrder.id === currentRegistrationId);
  const isGift = order.assistance_scope === "council_gift";
  const canModifyRegistration = !isGift && (currentRegistration?.user_id === currentUserId
    ? (currentRegistration.status === "pending" || currentRegistration.status === "confirmed")
      && !currentRegistration.is_paid
      && !currentRegistration.is_class_collected
    : Boolean(currentRegistration
      && currentRegistration.id === order.id
      && delegatedEditableItemIds.size > 0
      && (currentRegistration.status === "pending" || currentRegistration.status === "confirmed")
      && !currentRegistration.is_paid
      && !currentRegistration.is_class_collected));
  const classOrders = detailOrders.filter((relatedOrder) => relatedOrder.class_id
    && relatedOrder.assistance_scope !== "council_gift");
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
          <h1>{categoryPreorder?.label ?? order.category_name ?? (order.category_id ? "商品分類預購" : "一般商品預購")}</h1>
          {isGrouped ? (
            <p className="shop-order-detail-serial">分類預購詳情</p>
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
          <dt>{isGrouped ? "分類預購總額" : "預購總額"}</dt>
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
          {categoryPreorder && <div>
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
            <dd>{isGift ? "贈送，免付款" : paidOrders.length === detailOrders.length ? "班聯會已確認"
              : paidOrders.length > 0 ? "部分款項已確認" : "尚未確認"}</dd>
          </div>
        </dl>
        {canModifyRegistration && editableProductIds.size > 0 ? (
          <p className="shop-order-edit-note">
            {currentRegistration?.user_id === currentUserId
              ? "尚未收款，可修改下方仍開放的商品。"
              : "只能修改你代訂的品項；學生本人與其他家人的品項僅供查看。"}
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
            <div className="shop-order-item-main">
              <ProductThumbnail url={productImages[it.product_id]} />
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
                  {(it.gift_quantity ?? 0) > 0 && "折抵前 "}NT${it.unit_price.toLocaleString()} × {it.quantity}
                </p>
                <OrderItemGiftBreakdown items={[it]} />
                <OrderItemSources sources={detailOrders.flatMap((sourceOrder) => sourceOrder.items
                  .filter((source) => categoryPreorder ? source.product_id === it.product_id && source.unit_price === it.unit_price
                    && source.selected_options.map((option) => option.option_id).sort().join(",")
                      === it.selected_options.map((option) => option.option_id).sort().join(",") : source.id === it.id)
                  .map((item) => ({
                    item,
                    orderId: sourceOrder.id,
                    canEdit: canModifyRegistration && sourceOrder.id === currentRegistrationId
                      && editableProductIds.has(item.product_id)
                      && (currentUserId === sourceOrder.user_id || delegatedEditableItemIds.has(item.id)),
                  })))} onChange={() => void load(true)} />
              </div>
            </div>
            <div className="shrink-0">
              <p className="shop-order-item-total">{(it.gift_quantity ?? 0) > 0 && "折抵前 "}NT${it.subtotal.toLocaleString()}</p>
            </div>
          </article>
        ))}
        </div>
        <dl className="shop-order-totals">
          <div>
            <dt>商品小計</dt>
            <dd>NT${subtotalPrice.toLocaleString()}</dd>
          </div>
          <OrderPromotionSummary orders={detailOrders} />
          <div className="shop-order-grand-total">
            <dt>應付總額</dt>
            <dd><ShopPrice original={subtotalPrice} current={detailTotal} /></dd>
          </div>
        </dl>
      </section>

      {notes.length > 0 && (
        <section className="shop-order-detail-panel" aria-labelledby="shop-order-note-title">
          <h2 id="shop-order-note-title">備註</h2>
          {notes.map((note) => <p key={note} className="shop-order-detail-note">{note}</p>)}
        </section>
      )}

    </div>
  );
}
