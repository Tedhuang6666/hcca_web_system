"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { seatingApi, shopApi, apiErrorMessage } from "@/lib/api";
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
  const [order, setOrder] = useState<OrderOut | null>(null);
  const [assignments, setAssignments] = useState<SeatBookingOut[]>([]);
  const [seatingItems, setSeatingItems] = useState<SeatingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRoom, setUserRoom] = useState<string | null>(null);

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setUserRoom(userId ? `user:${userId}` : null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const o = await shopApi.getOrder(id);
      setOrder(o);
      seatingApi.orderAssignments(id).then((r) => setAssignments(r)).catch(() => setAssignments([]));

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

  if (loading) return <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>載入中…</div>;
  if (!order) return <div className="p-6">找不到訂單。<Link href="/shop/orders" className="btn btn-ghost text-sm ml-2">返回訂單</Link></div>;

  const assignedByZone = assignments.reduce<Record<string, SeatBookingOut[]>>((acc, a) => {
    (acc[a.zone_id] ||= []).push(a);
    return acc;
  }, {});
  const subtotalPrice = order.subtotal_price || order.items.reduce((sum, item) => sum + item.subtotal, 0);

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/shop/orders" className="btn btn-ghost text-sm">← 返回訂單</Link>
        <div>
          <h1 className="text-lg font-bold font-mono" style={{ color: "var(--primary)" }}>{order.serial_number}</h1>
          <div className="flex items-center gap-2 mt-1">
            <OrderStatusBadge status={order.status} />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              訂單金額 NT${order.total_price.toLocaleString()}
            </span>
          </div>
        </div>
        <div className="ml-auto">
        </div>
      </div>

      <section className="card p-4 space-y-3" aria-label="繳款進度">
        <h2 className="text-sm font-semibold">繳款進度</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt style={{ color: "var(--text-muted)" }}>訂單金額</dt>
            <dd className="mt-1 font-semibold">NT${order.total_price.toLocaleString()}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--text-muted)" }}>目前尚待繳交</dt>
            <dd className="mt-1 font-semibold">
              NT${(order.status === "cancelled" || order.status === "refunded" || order.is_paid || order.is_class_collected ? 0 : order.total_price).toLocaleString()}
            </dd>
          </div>
          {order.class_id && <div>
            <dt style={{ color: "var(--text-muted)" }}>班代收款紀錄</dt>
            <dd className="mt-1 font-medium">{order.is_class_collected ? "已登記收款" : "尚未登記收款"}</dd>
          </div>}
          <div>
            <dt style={{ color: "var(--text-muted)" }}>正式繳費狀態</dt>
            <dd className="mt-1 font-medium">{order.is_paid ? "班聯會已確認" : "尚未確認"}</dd>
          </div>
        </dl>
        {order.class_id && <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          班代的登記僅供班級收款紀錄；班聯會會另行確認整班繳款。
        </p>}
      </section>

      {/* 品項 */}
      <div className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold">訂購內容</h2>
        {order.items.map((it) => (
          <div key={it.id} className="border-t py-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {it.product_name ?? it.product_id.slice(0, 8)}
                </p>
                {it.selected_options.length > 0 && (
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {it.selected_options.map((option) => `${option.group_name}：${option.value}`).join("、")}
                  </p>
                )}
              </div>
              <p className="shrink-0 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                NT${it.subtotal.toLocaleString()}
              </p>
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              NT${it.unit_price.toLocaleString()} × {it.quantity} 件
            </p>
          </div>
        ))}
        <dl className="space-y-2 border-t pt-3 text-sm" style={{ borderColor: "var(--border)" }}>
          <div className="flex justify-between gap-4">
            <dt style={{ color: "var(--text-secondary)" }}>商品小計</dt>
            <dd>NT${subtotalPrice.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt style={{ color: "var(--text-secondary)" }}>
              優惠折抵{order.promotion_code ? `（${order.promotion_code}）` : ""}
            </dt>
            <dd style={{ color: order.discount_amount ? "var(--success)" : "var(--text-primary)" }}>
              − NT${order.discount_amount.toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-t pt-2 font-bold" style={{ borderColor: "var(--border)" }}>
            <dt>應付總額</dt>
            <dd>NT${order.total_price.toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      {/* 劃位 */}
      {seatingItems.map(({ product, quantity, zones }) => {
        const isAdminAssign = product.seating_mode === "admin_assign";
        return (
          <div key={product.id} className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">劃位 — {product.name}</h2>
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
                          <p className="text-xs mt-0.5" style={{ color: "var(--primary)" }}>
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

            {/* admin_assign 也顯示已被代劃的座位 */}
            {isAdminAssign && assignments.length > 0 && (
              <p className="text-sm" style={{ color: "var(--primary)" }}>
                已安排座位：{assignments.map((a) => a.seat_label).join(", ")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
