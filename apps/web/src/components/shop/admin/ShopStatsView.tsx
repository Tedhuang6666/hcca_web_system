"use client";

import { useEffect, useMemo, useState } from "react";
import { classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { Field, MiniBtn } from "@/components/shop/admin/ShopAdminFormFields";
import ShopPrintReports, { type ShopPurchaseReportFilters } from "@/components/shop/admin/ShopPrintReports";
import { listProductChoices } from "@/lib/shop-admin-data";
import type {
  SchoolClassListItem,
  ProductCategoryOut,
  ProductSeriesOut,
  ProductOut,
  OrderSummaryOut,
} from "@/lib/types";


export default function StatsView() {
  const [groupBy, setGroupBy] = useState<"class" | "grade" | "user">("class");
  const [data, setData] = useState<OrderSummaryOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [userOptions, setUserOptions] = useState<{ id: string; label: string }[]>([]);
  const [productId, setProductId] = useState("");
  const [grade, setGrade] = useState("");
  const [classId, setClassId] = useState("");
  const [userId, setUserId] = useState("");
  const [paid, setPaid] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [categories, setCategories] = useState<ProductCategoryOut[]>([]);
  const [series, setSeries] = useState<ProductSeriesOut[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [optionsError, setOptionsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOptionsError(false);
    Promise.all([
      listProductChoices(),
      classApi.recipientOptions(),
      shopApi.orderSummary({ group_by: "user" }),
      shopApi.listCategories(),
      shopApi.listSeries(),
    ]).then(([loadedProducts, loadedClasses, userSummary, loadedCategories, loadedSeries]) => {
      if (cancelled) return;
      setProducts(loadedProducts);
      setClasses(loadedClasses);
      setCategories(loadedCategories);
      setSeries(loadedSeries);
      setUserOptions(
        userSummary?.rows
          .filter((row) => row.key !== "none")
          .map((row) => ({ id: row.key, label: row.label })) ?? []
      );
    }).catch(() => { if (!cancelled) setOptionsError(true); });
    return () => { cancelled = true; };
  }, [retryKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    shopApi.orderSummary({
      group_by: groupBy,
      category_id: categoryId,
      product_id: productId,
      grade,
      class_id: classId,
      user_id: userId.trim(),
      status: statusFilter,
      is_paid: paid,
      date_from: dateFrom ? new Date(`${dateFrom}T00:00:00+08:00`).toISOString() : "",
      date_to: dateTo ? new Date(`${dateTo}T23:59:59+08:00`).toISOString() : "",
    })
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setError(apiErrorMessage(e, "統計載入失敗"));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [categoryId, classId, dateFrom, dateTo, grade, groupBy, paid, productId, statusFilter, userId, retryKey]);

  const groupOptions = [
    ["class", "依班級"],
    ["grade", "依年級"],
    ["user", "依個人"],
  ] as const;
  const gradeOptions = Array.from(
    new Set(classes.map((schoolClass) => schoolClass.grade).filter((value) => value !== null))
  ).sort((a, b) => a - b);
  const filteredClasses = classes.filter((schoolClass) =>
    (!grade || String(schoolClass.grade) === grade)
  );
  const resetFilters = () => {
    setCategoryId("");
    setProductId("");
    setGrade("");
    setClassId("");
    setUserId("");
    setPaid("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
  };
  const hasAdvancedFilters = Boolean(
    categoryId || productId || grade || classId || userId || paid || statusFilter || dateFrom || dateTo
  );
  const scopeLabels = [
    categories.find((category) => category.id === categoryId)?.name || "全部主題",
    products.find((product) => product.id === productId)?.name,
    grade && `${grade} 年級`,
    classes.find((schoolClass) => schoolClass.id === classId)?.label,
    userOptions.find((user) => user.id === userId)?.label,
    paid === "true" ? "班聯已確認" : paid === "false" ? "班聯未確認" : "全部收款狀態",
    statusFilter ? { pending: "待確認訂單", confirmed: "已確認訂單", cancelled: "已取消訂單", refunded: "已退款訂單" }[statusFilter] : "排除取消與退款",
    (dateFrom || dateTo) && `${dateFrom || "不限起日"} 至 ${dateTo || "不限迄日"}`,
  ].filter(Boolean);
  const printFilters = useMemo<ShopPurchaseReportFilters>(() => ({
    category_id: categoryId || undefined,
    product_id: productId || undefined,
    grade: grade || undefined,
    class_id: classId || undefined,
    user_id: userId.trim() || undefined,
    status: statusFilter || undefined,
    is_paid: paid || undefined,
    date_from: dateFrom ? new Date(`${dateFrom}T00:00:00+08:00`).toISOString() : undefined,
    date_to: dateTo ? new Date(`${dateTo}T23:59:59+08:00`).toISOString() : undefined,
  }), [categoryId, classId, dateFrom, dateTo, grade, paid, productId, statusFilter, userId]);

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="商品主題">
            <select className="input min-h-11 w-full min-w-0" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setProductId(""); }}>
              <option value="">全部主題</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </Field>
          <Field label="統計方式">
            <select className="input min-h-11 w-full min-w-0" value={groupBy} onChange={(event) => setGroupBy(event.target.value as "class" | "grade" | "user")}>
              {groupOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:flex sm:flex-wrap sm:items-center">
            <button type="button" className="btn btn-ghost min-h-11 w-full sm:w-auto" aria-expanded={advancedOpen} aria-controls="shop-stats-filters" onClick={() => setAdvancedOpen((value) => !value)}>
              {advancedOpen ? "收起篩選" : "更多篩選"}
            </button>
            <button type="button" className="btn btn-ghost min-h-11 w-full sm:w-auto" disabled={loading} onClick={() => setRetryKey((value) => value + 1)}>重新整理</button>
            {hasAdvancedFilters && (
              <div className="col-span-2 sm:col-span-1">
                <MiniBtn onClick={resetFilters}>清除篩選</MiniBtn>
              </div>
            )}
          </div>
        </div>
        <p className="text-sm text-fg-secondary!">統計範圍：{scopeLabels.join(" · ")}</p>
        {optionsError && <div role="alert" className="flex flex-col items-start gap-2 text-sm text-danger! sm:flex-row sm:items-center">
          篩選選項載入失敗。<button type="button" className="btn btn-ghost min-h-11" onClick={() => setRetryKey((value) => value + 1)}>重新載入選項</button>
        </div>}
        {advancedOpen && (
          <div id="shop-stats-filters" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="商品">
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input min-h-11 w-full min-w-0">
                <option value="">全部商品</option>
                {products.filter((product) => {
                  const productCategoryId = product.category_id ?? series.find((item) => item.id === product.series_id)?.category_id;
                  return !categoryId || productCategoryId === categoryId;
                }).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </Field>
            <Field label="年級">
              <select value={grade} onChange={(e) => { setGrade(e.target.value); setClassId(""); }} className="input min-h-11 w-full min-w-0">
                <option value="">全部年級</option>
                {gradeOptions.map((value) => <option key={value} value={value}>{value} 年級</option>)}
              </select>
            </Field>
            <Field label="班級">
              <select value={classId} onChange={(e) => setClassId(e.target.value)} className="input min-h-11 w-full min-w-0">
                <option value="">全部班級</option>
                {filteredClasses.map((schoolClass) => (
                  <option key={schoolClass.id} value={schoolClass.id}>
                    {schoolClass.label || schoolClass.class_code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="訂購人">
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className="input min-h-11 w-full min-w-0">
                <option value="">全部訂購人</option>
                {userOptions.map((user) => (
                  <option key={user.id} value={user.id}>{user.label}</option>
                ))}
              </select>
            </Field>
            <Field label="班聯收款狀態">
              <select value={paid} onChange={(e) => setPaid(e.target.value)} className="input min-h-11 w-full min-w-0">
                <option value="">全部</option>
                <option value="true">班聯已確認</option>
                <option value="false">班聯未確認</option>
              </select>
            </Field>
            <Field label="訂單狀態">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input min-h-11 w-full min-w-0">
                <option value="">排除取消與退款</option>
                <option value="pending">待確認</option>
                <option value="confirmed">已確認</option>
                <option value="cancelled">已取消</option>
                <option value="refunded">已退款</option>
              </select>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2">
              <Field label="訂購起日">
                <input type="date" max={dateTo || undefined} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input min-h-11 w-full min-w-0" />
              </Field>
              <Field label="訂購迄日">
                <input type="date" min={dateFrom || undefined} value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input min-h-11 w-full min-w-0" />
              </Field>
            </div>
          </div>
        )}
      </div>
      <ShopPrintReports
        filters={printFilters}
        scope={scopeLabels.join(" · ")}
        titleScope={categories.find((category) => category.id === categoryId)?.name || "全部主題"}
        refreshKey={retryKey}
        shareClassSummary={groupBy === "class"}
        classSummary={groupBy === "class" ? data : undefined}
        classSummaryLoading={groupBy === "class" && loading}
      />
      {loading && (
        <div role="status" className="card p-8 text-center text-sm text-fg-muted!">
          載入統計中…
        </div>
      )}
      {error && (
        <div role="alert" className="card p-4 text-sm text-danger!">
          <p>{error}</p>
          <MiniBtn onClick={() => setRetryKey((value) => value + 1)}>重新載入統計</MiniBtn>
        </div>
      )}
      {!loading && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "訂購金額", value: data.total_amount },
              { label: "班聯已確認收款", value: data.paid_amount },
              { label: "班聯尚未確認收款", value: data.unpaid_amount },
            ].map(({ label, value }) => (
              <div key={label} className="card p-4 text-center">
                <p className="text-xs mb-1 text-fg-muted!">{label}</p>
                <p className="text-lg font-bold text-accent-text!">
                  NT${value.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:hidden">
            {data.rows.length === 0 ? (
              <div className="card p-6 text-center text-sm text-fg-muted!">
                <p>目前範圍沒有訂單；可清除篩選或改選其他商品主題。</p>
                {hasAdvancedFilters && <button type="button" className="btn btn-ghost mt-3 min-h-11" onClick={resetFilters}>查看全部統計</button>}
              </div>
            ) : data.rows.map((r) => (
              <div key={r.key} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-fg-primary!">{r.label}</p>
                    <p className="text-xs mt-1 text-fg-muted!">
                      {r.order_count} 筆訂單 · {r.item_count} 件
                    </p>
                  </div>
                  <p className="shrink-0 text-right font-bold tabular-nums text-accent-text!">
                    NT${r.total_amount.toLocaleString()}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg p-2 bg-elevated!">
                    <p className="text-fg-muted!">班聯已確認</p>
                    <p className="font-semibold mt-0.5 text-success!">NT${r.paid_amount.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg p-2 bg-elevated!">
                    <p className="text-fg-muted!">班聯未確認</p>
                    <p className="font-semibold mt-0.5 text-fg-primary!">NT${r.unpaid_amount.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="card overflow-x-auto hidden sm:block">
            <table className="w-full min-w-[680px] text-sm tabular-nums">
              <thead>
                <tr className="border-b border-border!">
                  {[groupBy === "class" ? "班級" : groupBy === "grade" ? "年級" : "訂購人", "訂單數", "商品件數", "訂購金額", "班聯已確認", "班聯未確認"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-fg-muted!" scope="col">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-fg-muted!">
                    <p>目前範圍沒有訂單；可清除篩選或改選其他商品主題。</p>
                    {hasAdvancedFilters && <button type="button" className="btn btn-ghost mt-3 min-h-11" onClick={resetFilters}>查看全部統計</button>}
                  </td></tr>
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.key} className="border-b border-border!">
                      <td className="px-4 py-3 text-fg-primary!">{r.label}</td>
                      <td className="px-4 py-3 text-fg-secondary!">{r.order_count}</td>
                      <td className="px-4 py-3 text-fg-secondary!">{r.item_count}</td>
                      <td className="px-4 py-3 text-fg-primary!">
                        NT${r.total_amount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-success!">
                        NT${r.paid_amount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-fg-muted!">
                        NT${r.unpaid_amount.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
