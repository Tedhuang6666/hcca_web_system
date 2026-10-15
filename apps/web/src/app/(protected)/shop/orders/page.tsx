"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { OrderListItem, ShopDelegatedOrderOut } from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import { useWS } from "@/hooks/useWS";
import { groupActivityPreorders } from "@/lib/shop-preorders";
import ProductThumbnail from "@/components/shop/ProductThumbnail";

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [userRoom, setUserRoom] = useState<string | null>(null);
  const [productImages, setProductImages] = useState<Record<string, string | null>>({});
  const [delegatedOrderIds, setDelegatedOrderIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setUserRoom(userId ? `user:${userId}` : null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const allOrders: OrderListItem[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await shopApi.listOrders({ limit: "500", offset: String(offset), my_only: "true" });
        allOrders.push(...page);
        if (page.length < 500) break;
      }
      const delegatedOrders: ShopDelegatedOrderOut[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await shopApi.listDelegatedOrders({ limit: "500", offset: String(offset) });
        delegatedOrders.push(...page);
        if (page.length < 500) break;
      }
      setOrders([...allOrders, ...delegatedOrders.map((entry) => entry.order)]);
      setDelegatedOrderIds(new Set(delegatedOrders.map((entry) => entry.order.id)));
    } catch (error) {
      setLoadError(apiErrorMessage(error, "無法載入登記紀錄，請重試。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useWS(userRoom, useCallback((message) => {
    if (message.type === "order.updated") void load();
  }, [load]));

  const activityGroups = groupActivityPreorders(orders);
  const productIdsKey = [...new Set(activityGroups.flatMap((group) =>
    group.items.map((item) => item.product_id),
  ))].join(",");

  useEffect(() => {
    if (!productIdsKey) return;

    let cancelled = false;
    const productIds = productIdsKey.split(",");
    void (async () => {
      const catalog = await shopApi.catalog().catch(() => []);
      const images = new Map<string, string | null>();
      for (const category of catalog) {
        for (const product of category.products) images.set(product.id, product.image_url ?? null);
        for (const series of category.series) {
          for (const product of series.products) images.set(product.id, product.image_url ?? null);
        }
      }

      await Promise.all(productIds.filter((id) => !images.has(id)).map(async (id) => {
        try {
          const product = await shopApi.getProduct(id);
          images.set(id, product.image_url ?? null);
        } catch {
          images.set(id, null);
        }
      }));

      if (!cancelled) setProductImages(Object.fromEntries(images));
    })();

    return () => { cancelled = true; };
  }, [productIdsKey]);

  return (
    <div className="shop-orders-page">
      <header className="shop-orders-header">
        <div className="shop-orders-heading">
          <Link href="/shop" className="shop-orders-back" aria-label="返回商品頁">
            <ArrowLeft size={17} aria-hidden="true" />
          </Link>
          <h1>我的預購與代訂</h1>
        </div>
      </header>

      <section className="shop-orders-list" aria-labelledby="shop-orders-list-title">
        <h2 id="shop-orders-list-title">預購品項</h2>
        {loading ? (
          <div className="py-3">
            <ListPageSkeleton rows={4} showHeader={false} showFilters={false} />
          </div>
        ) : loadError ? (
          <div role="alert" className="shop-orders-error">
            <p>{loadError}</p>
            <button type="button" onClick={() => void load()} className="shop-order-details">重新載入</button>
          </div>
        ) : activityGroups.length === 0 ? (
          <SmartEmptyState
            reason="new"
            subject="預購品項"
            createHref="/shop"
            message="目前沒有預購品項，先到商品頁挑選商品。"
          />
        ) : (
          <div className="shop-order-activity-list">
            {activityGroups.map((group) => (
              <Link
                key={group.key}
                href={`/shop/orders/${group.orders[0].id}`}
                className="shop-order-activity-link"
                aria-label={`查看${group.label}預購詳情`}
              >
                <section className="shop-order-activity" aria-label={`${group.label}預購`}>
                  <div className="shop-order-activity-heading">
                    <div>
                      <h3>{group.label}</h3>
                      {group.orders.some((order) => delegatedOrderIds.has(order.id)) && (
                        <p className="shop-order-delegated-note">
                          明細中只能修改你代訂的品項，其他來源僅供查看。
                        </p>
                      )}
                    </div>
                    <div className="shop-order-activity-amounts">
                      <strong>合計 NT${group.amount.toLocaleString("zh-TW")}</strong>
                      <span>
                        已繳 NT${group.received.toLocaleString("zh-TW")} · {group.received > 0 && group.outstanding > 0 ? "待補繳" : "待繳"} NT${group.outstanding.toLocaleString("zh-TW")}
                      </span>
                    </div>
                  </div>
                  <ul className="shop-preorder-items" aria-label={`${group.label}品項`}>
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <ProductThumbnail url={productImages[item.product_id]} />
                        <div className="min-w-0 flex-1">
                          <span>{item.product_name ?? "商品"}</span>
                          {item.selected_options.length > 0 && (
                            <p>{item.selected_options.map((option) => option.value).join("／")}</p>
                          )}
                        </div>
                        <span className="shop-preorder-quantity">× {item.quantity}</span>
                      </li>
                    ))}
                  </ul>
                  {group.items.length === 0 && <p className="shop-order-row-items">品項資訊請查看訂單詳情。</p>}
                  <div className="shop-preorder-info">
                    <span>{group.hasClassOrders ? "向班代繳款" : "依活動通知繳款"}</span>
                    <span className="shop-order-details">
                      查看訂單詳情 <ArrowRight size={15} aria-hidden="true" />
                    </span>
                  </div>
                </section>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
