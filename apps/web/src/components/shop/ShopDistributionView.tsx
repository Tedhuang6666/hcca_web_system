"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { Field, MiniBtn } from "@/components/shop/admin/ShopAdminFormFields";
import { listProductChoices } from "@/lib/shop-admin-data";
import type { OrderDistributionRow, ProductOut, SchoolClassListItem } from "@/lib/types";

type Props = { refreshKey: number };

type ClassRow = {
  id: string | null;
  label: string;
  grade: number | null;
  classCode: string;
};

function classLabel(schoolClass: SchoolClassListItem): string {
  return schoolClass.label || schoolClass.class_code;
}

export default function ShopDistributionView({ refreshKey }: Props) {
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [productId, setProductId] = useState("");
  const [classId, setClassId] = useState("");
  const [rows, setRows] = useState<OrderDistributionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError("");
    Promise.all([listProductChoices(), classApi.recipientOptions()])
      .then(([loadedProducts, loadedClasses]) => {
        if (cancelled) return;
        setProducts(loadedProducts);
        setClasses(loadedClasses);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setOptionsError(apiErrorMessage(loadError, "篩選選項載入失敗。"));
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    shopApi.orderDistribution({
      ...(productId ? { product_id: productId } : {}),
      ...(classId ? { class_id: classId } : {}),
    })
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setRows([]);
        setError(apiErrorMessage(loadError, "分貨數量載入失敗。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, productId, refreshKey, retryKey]);

  const productGroups = useMemo(() => {
    const grouped = new Map<string, OrderDistributionRow[]>();
    for (const row of rows) {
      const group = grouped.get(row.product_id) ?? [];
      group.push(row);
      grouped.set(row.product_id, group);
    }
    return Array.from(grouped.entries())
      .map(([id, productRows]) => ({ id, rows: productRows }))
      .sort((a, b) => a.rows[0].product_name.localeCompare(b.rows[0].product_name, "zh-TW"));
  }, [rows]);

  const totalQuantity = rows.reduce((total, row) => total + row.qty_total, 0);
  const hasFilters = Boolean(productId || classId);
  const resetFilters = () => {
    setProductId("");
    setClassId("");
  };

  const classesForGroup = useCallback((productRows: OrderDistributionRow[]): ClassRow[] => {
    if (classId) {
      const selected = classes.find((schoolClass) => schoolClass.id === classId);
      const row = productRows.find((item) => item.class_id === classId);
      if (selected) {
        return [{
          id: selected.id,
          label: classLabel(selected),
          grade: selected.grade,
          classCode: selected.class_code,
        }];
      }
      return row ? [{
        id: row.class_id,
        label: row.class_label,
        grade: row.grade ?? null,
        classCode: "",
      }] : [];
    }

    const classRows = new Map<string, ClassRow>();
    if (productId) {
      for (const schoolClass of classes) {
        classRows.set(schoolClass.id, {
          id: schoolClass.id,
          label: classLabel(schoolClass),
          grade: schoolClass.grade,
          classCode: schoolClass.class_code,
        });
      }
    }
    for (const row of productRows) {
      const key = row.class_id ?? "unassigned";
      const existing = classRows.get(key);
      classRows.set(key, {
        id: row.class_id,
        label: row.class_label,
        grade: row.grade ?? null,
        classCode: existing?.classCode ?? "",
      });
    }
    return Array.from(classRows.values()).sort((a, b) => {
      if (a.id === null) return 1;
      if (b.id === null) return -1;
      return (a.grade ?? Number.MAX_SAFE_INTEGER) - (b.grade ?? Number.MAX_SAFE_INTEGER)
        || a.classCode.localeCompare(b.classCode, "zh-TW")
        || a.label.localeCompare(b.label, "zh-TW");
    });
  }, [classId, classes, productId]);

  return (
    <section className="space-y-4" aria-label="分貨統計">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border! border-border! bg-card! p-4">
        <Field label="商品">
          <select
            className="input min-h-11 w-full min-w-0 sm:min-w-56"
            value={productId}
            disabled={optionsLoading}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">全部商品</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
        </Field>
        <Field label="班級">
          <select
            className="input min-h-11 w-full min-w-0 sm:min-w-48"
            value={classId}
            disabled={optionsLoading}
            onChange={(event) => setClassId(event.target.value)}
          >
            <option value="">全部班級</option>
            {classes.map((schoolClass) => (
              <option key={schoolClass.id} value={schoolClass.id}>{classLabel(schoolClass)}</option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className="btn btn-ghost min-h-11"
          disabled={loading}
          onClick={() => setRetryKey((value) => value + 1)}
        >
          重新整理
        </button>
        {hasFilters && <MiniBtn onClick={resetFilters}>清除篩選</MiniBtn>}
        {!loading && !error && rows.length > 0 && (
          <p className="ml-auto min-h-11 self-center text-sm tabular-nums text-fg-secondary!">
            {totalQuantity.toLocaleString("zh-TW")} 件
          </p>
        )}
      </div>

      {optionsError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger!">
          <span>{optionsError}</span>
          <button
            type="button"
            className="btn btn-ghost min-h-11"
            onClick={() => setRetryKey((value) => value + 1)}
          >
            重新載入篩選選項
          </button>
        </div>
      )}
      {loading && <p role="status" className="py-10 text-center text-sm text-fg-muted!">載入分貨數量中…</p>}
      {error && (
        <div role="alert" className="rounded-lg border! border-border! p-4 text-sm text-danger!">
          <p>{error}</p>
          <button
            type="button"
            className="btn btn-ghost mt-2 min-h-11"
            onClick={() => setRetryKey((value) => value + 1)}
          >
            重新載入分貨數量
          </button>
        </div>
      )}
      {!loading && !error && productGroups.length === 0 && (
        <p role="status" className="py-10 text-center text-sm text-fg-muted!">
          目前沒有符合篩選的訂購數量。
        </p>
      )}

      {!loading && !error && productGroups.map(({ id, rows: productRows }) => {
        const variants = Array.from(new Set(productRows.map((row) => row.variant_key)))
          .sort((a, b) => a.localeCompare(b, "zh-TW"));
        const classRows = classesForGroup(productRows);
        const quantityByClassAndVariant = new Map<string, number>();
        for (const row of productRows) {
          const key = `${row.class_id ?? "unassigned"}:${row.variant_key}`;
          quantityByClassAndVariant.set(key, (quantityByClassAndVariant.get(key) ?? 0) + row.qty_total);
        }
        const variantTotals = new Map(variants.map((variant) => [variant, 0]));
        for (const row of productRows) {
          variantTotals.set(row.variant_key, (variantTotals.get(row.variant_key) ?? 0) + row.qty_total);
        }
        const productTotal = productRows.reduce((total, row) => total + row.qty_total, 0);

        return (
          <section key={id} className="border-t! border-border! pt-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-fg-primary!">{productRows[0].product_name}</h2>
              <p className="text-sm font-semibold tabular-nums text-fg-secondary!">
                {productTotal.toLocaleString("zh-TW")} 件
              </p>
            </div>
            {productRows[0].series_name && (
              <p className="mb-2 text-sm text-fg-muted!">{productRows[0].series_name}</p>
            )}
            <div className="overflow-x-auto rounded-lg border! border-border!">
              <table className="w-full min-w-max border-collapse text-sm">
                <caption className="sr-only">{productRows[0].product_name}各班級規格數量</caption>
                <thead className="bg-elevated! text-left text-fg-secondary!">
                  <tr>
                    <th scope="col" className="sticky left-0 min-w-28 bg-elevated! px-3 py-2 font-medium">班級</th>
                    {variants.map((variant) => (
                      <th key={variant} scope="col" className="min-w-24 px-3 py-2 text-right font-medium">{variant}</th>
                    ))}
                    <th scope="col" className="min-w-24 px-3 py-2 text-right font-semibold">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {classRows.map((schoolClass) => {
                    const quantities = variants.map((variant) =>
                      quantityByClassAndVariant.get(`${schoolClass.id ?? "unassigned"}:${variant}`) ?? 0
                    );
                    const classTotal = quantities.reduce((total, quantity) => total + quantity, 0);
                    return (
                      <tr key={schoolClass.id ?? "unassigned"} className="border-t! border-border!">
                        <th scope="row" className="sticky left-0 bg-card! px-3 py-2 text-left font-medium text-fg-primary!">{schoolClass.label}</th>
                        {quantities.map((quantity, index) => (
                          <td key={variants[index]} className="px-3 py-2 text-right tabular-nums text-fg-primary!">{quantity.toLocaleString("zh-TW")}</td>
                        ))}
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg-primary!">{classTotal.toLocaleString("zh-TW")}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t! border-border! bg-elevated! font-semibold text-fg-primary!">
                  <tr>
                    <th scope="row" className="sticky left-0 bg-elevated! px-3 py-2 text-left">總計</th>
                    {variants.map((variant) => (
                      <td key={variant} className="px-3 py-2 text-right tabular-nums">{(variantTotals.get(variant) ?? 0).toLocaleString("zh-TW")}</td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums">{productTotal.toLocaleString("zh-TW")}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        );
      })}
    </section>
  );
}
