"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart2, Download, Lock, LockOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { shopApi, apiErrorMessage } from "@/lib/api";
import type {
  CatalogCategoryOut,
  CloseStatusItem,
  OrderListItem,
  OrderQuantityRow,
  OrderSummaryOut,
  OrderSummaryRow,
} from "@/lib/types";

type Tab = "summary" | "quantities" | "orders";

function money(v: number) {
  return `NT$${v.toLocaleString("zh-TW")}`;
}

// ── 結單狀態徽章 ─────────────────────────────────────────────────────────────

function CloseBadge({ status }: { status: CloseStatusItem | undefined }) {
  if (!status?.is_closed) return (
    <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: "rgba(34,197,94,0.12)", color: "#16a34a" }}>
      開放中
    </span>
  );
  return (
    <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
      已結單
    </span>
  );
}

// ── 主頁面 ───────────────────────────────────────────────────────────────────

export default function CouncilOrdersPage() {
  const [tab, setTab] = useState<Tab>("summary");

  // 篩選
  const [grade, setGrade] = useState("");
  const [classId, setClassId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [productId, setProductId] = useState("");
  const [isPaid, setIsPaid] = useState("");

  // 資料
  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>([]);
  const [summary, setSummary] = useState<OrderSummaryOut | null>(null);
  const [quantities, setQuantities] = useState<OrderQuantityRow[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [closeStatus, setCloseStatus] = useState<Record<string, Record<string, CloseStatusItem>>>({});
  const [loading, setLoading] = useState(false);
  const [closeBusy, setCloseBusy] = useState<string | null>(null);

  // 班聯結單選擇
  const [closeTarget, setCloseTarget] = useState<{ categoryId: string; classId: string; label: string } | null>(null);

  useEffect(() => {
    shopApi.catalog().then(setCatalog).catch(() => {});
  }, []);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const params: Parameters<typeof shopApi.orderSummary>[0] = { group_by: "class" };
      if (grade) params.grade = grade;
      if (classId) params.class_id = classId;
      if (isPaid) params.is_paid = isPaid;
      const data = await shopApi.orderSummary(params);
      setSummary(data);

      // 批次查詢每個 row 的結單狀態
      if (data.rows.length && catalog.length) {
        const catIds = catalog.map((c) => c.id);
        const statusMap: Record<string, Record<string, CloseStatusItem>> = {};
        await Promise.all(
          data.rows.map(async (row) => {
            try {
              const res = await shopApi.getCloseStatus(catIds, row.key);
              statusMap[row.key] = res.statuses;
            } catch {
              statusMap[row.key] = {};
            }
          }),
        );
        setCloseStatus(statusMap);
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入失敗"));
    } finally {
      setLoading(false);
    }
  }, [grade, classId, categoryId, isPaid, catalog]);

  const loadQuantities = useCallback(async () => {
    setLoading(true);
    try {
      const params: Parameters<typeof shopApi.orderQuantities>[0] = {};
      if (grade) params!.grade = grade;
      if (classId) params!.class_id = classId;
      if (categoryId) params!.category_id = categoryId;
      if (productId) params!.product_id = productId;
      if (isPaid) params!.is_paid = isPaid;
      const data = await shopApi.orderQuantities(params);
      setQuantities(data);
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入失敗"));
    } finally {
      setLoading(false);
    }
  }, [grade, classId, categoryId, productId, isPaid]);

  const loadOrders = useCallback(async () => {
    if (!classId && !grade) { setOrders([]); return; }
    setLoading(true);
    try {
      const params: Record<string, string> = { my_only: "false", limit: "200" };
      if (grade) params.grade = grade;
      if (classId) params.class_id = classId;
      if (isPaid) params.is_paid = isPaid;
      const data = await shopApi.listOrders(params);
      setOrders(data);
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入失敗"));
    } finally {
      setLoading(false);
    }
  }, [grade, classId, isPaid]);

  useEffect(() => {
    if (tab === "summary") loadSummary();
    else if (tab === "quantities") loadQuantities();
    else loadOrders();
  }, [tab, loadSummary, loadQuantities, loadOrders]);

  const handleToggleClose = async (catId: string, targetClassId: string, isCurrentlyClosed: boolean, label: string) => {
    if (!isCurrentlyClosed) {
      setCloseTarget({ categoryId: catId, classId: targetClassId, label });
      return;
    }
    await doReopen(catId, targetClassId);
  };

  const doClose = async () => {
    if (!closeTarget) return;
    setCloseBusy(`${closeTarget.categoryId}:${closeTarget.classId}`);
    try {
      await shopApi.closeCategory(closeTarget.categoryId, { class_id: closeTarget.classId });
      toast.success(`已為班級「${closeTarget.label}」結單`);
      setCloseTarget(null);
      await loadSummary();
    } catch (e) {
      toast.error(apiErrorMessage(e, "結單失敗"));
    } finally {
      setCloseBusy(null);
    }
  };

  const doReopen = async (catId: string, targetClassId: string) => {
    setCloseBusy(`${catId}:${targetClassId}`);
    try {
      await shopApi.reopenCategory(catId, targetClassId);
      toast.success("已重新開單");
      await loadSummary();
    } catch (e) {
      toast.error(apiErrorMessage(e, "重新開單失敗"));
    } finally {
      setCloseBusy(null);
    }
  };

  const batchClose = async (rows: OrderSummaryRow[], open: boolean) => {
    if (!catalog.length) return;
    const catIds = catalog.map((c) => c.id);
    setLoading(true);
    let count = 0;
    for (const row of rows) {
      for (const catId of catIds) {
        const isClosed = closeStatus[row.key]?.[catId]?.is_closed ?? false;
        if (open && isClosed) {
          try { await shopApi.reopenCategory(catId, row.key); count++; } catch { /* skip */ }
        } else if (!open && !isClosed) {
          try { await shopApi.closeCategory(catId, { class_id: row.key }); count++; } catch { /* skip */ }
        }
      }
    }
    toast.success(open ? `已重開 ${count} 個結單` : `已結單 ${count} 個`);
    await loadSummary();
    setLoading(false);
  };

  const allProducts = useMemo(() =>
    catalog.flatMap((c) => c.series.flatMap((s) => s.products.map((p) => ({ ...p, catId: c.id })))),
    [catalog],
  );

  const gradeOptions = useMemo(() => {
    const grades = new Set<string>();
    summary?.rows.forEach((r) => {
      // rows are classes; try to parse grade from label like "三年甲班"
    });
    return [1, 2, 3, 4, 5, 6].map((g) => ({ value: String(g), label: `${g} 年級` }));
  }, [summary]);

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>校慶商品</p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            <BarChart2 size={22} /> 班聯訂購管理
          </h1>
        </div>
        <button type="button" onClick={() => { if (tab === "summary") loadSummary(); else if (tab === "quantities") loadQuantities(); else loadOrders(); }}
          className="btn btn-ghost" aria-label="重新整理">
          <RefreshCw size={15} /> 重新整理
        </button>
      </header>

      {/* 篩選列 */}
      <section className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>年級</span>
            <select className="input" value={grade} onChange={(e) => { setGrade(e.target.value); setClassId(""); }}>
              <option value="">全部年級</option>
              {gradeOptions.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>分類</span>
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">全部分類</option>
              {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {tab === "quantities" && (
            <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>商品</span>
              <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">全部商品</option>
                {allProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>繳費狀態</span>
            <select className="input" value={isPaid} onChange={(e) => setIsPaid(e.target.value)}>
              <option value="">全部</option>
              <option value="true">已繳費</option>
              <option value="false">未繳費</option>
            </select>
          </label>
        </div>
      </section>

      {/* Tab 切換 */}
      <div className="flex gap-1 rounded-lg p-1" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)", width: "fit-content" }}>
        {([ ["summary", "班級彙總"], ["quantities", "商品數量"], ["orders", "訂單明細"] ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className="rounded-md px-4 py-2 text-sm font-medium transition-colors"
            style={tab === t
              ? { background: "var(--card-bg)", color: "var(--primary)", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
              : { color: "var(--text-muted)" }}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1：班級彙總 */}
      {tab === "summary" && (
        <section>
          {summary && (
            <div className="mb-3 grid gap-3 sm:grid-cols-3">
              {[
                { label: "總金額", value: money(summary.total_amount) },
                { label: "已繳", value: money(summary.paid_amount) },
                { label: "未繳", value: money(summary.unpaid_amount) },
              ].map((item) => (
                <div key={item.label} className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{item.label}</p>
                  <p className="mt-1 text-xl font-bold" style={{ color: "var(--primary)" }}>{item.value}</p>
                </div>
              ))}
            </div>
          )}

          {summary && summary.rows.length > 0 && catalog.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => batchClose(summary.rows, false)} disabled={loading}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                style={{ border: "1px solid var(--border)", color: "#ef4444" }}>
                <Lock size={12} /> 批次結單（全篩選班級）
              </button>
              <button type="button" onClick={() => batchClose(summary.rows, true)} disabled={loading}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                style={{ border: "1px solid var(--border)", color: "#16a34a" }}>
                <LockOpen size={12} /> 批次重開（全篩選班級）
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            {loading ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
            ) : !summary?.rows.length ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>沒有符合條件的資料</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["班級", "訂單數", "總金額", "已繳", "未繳", ...catalog.map((c) => c.name + "結單"), "操作"].map((h, i) => (
                        <th key={i} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((row, idx) => (
                      <tr key={row.key} style={idx < summary.rows.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                        <td className="px-4 py-3 font-medium" style={{ color: "var(--text-primary)" }}>{row.label}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{row.order_count}</td>
                        <td className="px-4 py-3 text-xs">{money(row.total_amount)}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "#16a34a" }}>{money(row.paid_amount)}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "#ef4444" }}>{money(row.unpaid_amount)}</td>
                        {catalog.map((cat) => (
                          <td key={cat.id} className="px-4 py-3">
                            <CloseBadge status={closeStatus[row.key]?.[cat.id]} />
                          </td>
                        ))}
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {catalog.map((cat) => {
                              const isClosed = closeStatus[row.key]?.[cat.id]?.is_closed ?? false;
                              const isBusy = closeBusy === `${cat.id}:${row.key}`;
                              return (
                                <button key={cat.id} type="button" disabled={isBusy}
                                  onClick={() => handleToggleClose(cat.id, row.key, isClosed, row.label)}
                                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs disabled:opacity-50"
                                  style={{ border: "1px solid var(--border)", color: isClosed ? "#16a34a" : "#ef4444" }}
                                  title={`${isClosed ? "重開" : "結單"}：${cat.name}`}>
                                  {isBusy ? "..." : isClosed ? <LockOpen size={10} /> : <Lock size={10} />}
                                  {cat.name.slice(0, 4)}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Tab 2：商品數量 */}
      {tab === "quantities" && (
        <section>
          <div className="mb-3 flex justify-end">
            <a href={`/api/shop/reports/orders.xlsx${grade ? `?grade=${grade}` : ""}`}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              <Download size={13} /> 匯出 Excel
            </a>
          </div>
          <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            {loading ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
            ) : !quantities.length ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>沒有符合條件的資料</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["商品", "系列", "規格組合", "訂購數", "已繳數"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {quantities.map((row, idx) => (
                      <tr key={`${row.product_id}:${row.variant_key}`}
                        style={idx < quantities.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                        <td className="px-4 py-3 font-medium" style={{ color: "var(--text-primary)" }}>{row.product_name}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{row.series_name}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{row.variant_key}</td>
                        <td className="px-4 py-3">
                          <span className="font-bold text-lg" style={{ color: "var(--primary)" }}>{row.qty_total}</span>
                          <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>件</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium" style={{ color: "#16a34a" }}>{row.qty_paid}</span>
                          <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>件</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot style={{ borderTop: "2px solid var(--border)" }}>
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-xs font-semibold" style={{ color: "var(--text-muted)" }}>合計</td>
                      <td className="px-4 py-3">
                        <span className="font-bold" style={{ color: "var(--primary)" }}>
                          {quantities.reduce((sum, r) => sum + r.qty_total, 0)}
                        </span>
                        <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>件</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-bold" style={{ color: "#16a34a" }}>
                          {quantities.reduce((sum, r) => sum + r.qty_paid, 0)}
                        </span>
                        <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>件</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Tab 3：訂單明細 */}
      {tab === "orders" && (
        <section>
          {!classId && !grade ? (
            <div className="py-16 text-center rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-muted)" }}>
              <p className="text-sm">請先選擇年級或篩選條件後查詢</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              {loading ? (
                <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
              ) : !orders.length ? (
                <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>沒有符合條件的訂單</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["訂單編號", "學生", "班級", "狀態", "金額", "繳費", "建立時間"].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order, idx) => (
                        <tr key={order.id} style={idx < orders.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs" style={{ color: "var(--primary)" }}>{order.serial_number}</span>
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{order.user_name ?? "-"}</td>
                          <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{order.class_label ?? "-"}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-full px-2 py-0.5 text-xs"
                              style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                              {order.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs font-medium">{money(order.total_price)}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-full px-2 py-0.5 text-xs"
                              style={order.is_paid
                                ? { background: "rgba(34,197,94,0.12)", color: "#16a34a" }
                                : { background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                              {order.is_paid ? "已繳費" : "未繳費"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                            {new Date(order.created_at).toLocaleDateString("zh-TW")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* 結單確認 Modal */}
      {closeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl p-6 shadow-xl" style={{ background: "var(--card-bg)" }}>
            <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>確認結單</h3>
            <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
              確定要為班級「<strong>{closeTarget.label}</strong>」的訂購分類結單？
              <br />結單後該班學生無法新增訂單。
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button type="button" onClick={() => setCloseTarget(null)} className="btn btn-ghost">取消</button>
              <button type="button" onClick={doClose} disabled={closeBusy !== null}
                className="btn disabled:opacity-50"
                style={{ background: "#ef4444", color: "white", border: "none" }}>
                {closeBusy ? "結單中..." : "確認結單"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
