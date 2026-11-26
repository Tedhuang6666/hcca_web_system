"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import { apiErrorMessage, shopApi } from "@/lib/api";
import type {
  OrderPurchaseDetailRow,
  OrderQuantityRow,
  OrderSummaryOut,
} from "@/lib/types";

import styles from "./ShopPrintDocument.module.css";
import { classOrderPages } from "./class-order-document";

export type ShopPurchaseReportFilters = {
  activity_id?: string;
  category_id?: string;
  product_id?: string;
  grade?: string;
  class_id?: string;
  user_id?: string;
  status?: string;
  is_paid?: string;
  date_from?: string;
  date_to?: string;
};

type ReportType = "classes" | "people" | "council" | "class-sheet" | "class-totals";

type ReportData =
  | { type: "classes"; result: OrderSummaryOut }
  | { type: "people"; result: OrderPurchaseDetailRow[] }
  | { type: "class-sheet"; result: OrderPurchaseDetailRow[] }
  | { type: "class-totals" }
  | { type: "council"; result: OrderQuantityRow[] };

const REPORTS: { id: ReportType; label: string }[] = [
  { id: "class-sheet", label: "班級訂購明細" },
  { id: "class-totals", label: "各班總數明細" },
  { id: "council", label: "班聯商品尺寸總表" },
];

const number = (value: number) => value.toLocaleString("zh-TW");
const money = (value: number) => `NT$${number(value)}`;

function ReportTable({ data, scope }: { data: ReportData; scope: string }) {
  if (data.type === "class-totals") return null;
  if (data.type === "class-sheet") {
    const pages = classOrderPages(data.result);
    if (!pages.length) return <p className={styles.empty}>目前沒有符合篩選的訂購明細。</p>;
    return <div>{pages.map((page) => (
      <section className={styles.classSheet} key={page.key}>
        <h3>{scope} 數量明細 - {page.label}</h3>
        <table className={`${styles.table} ${styles.classSheetTable}`}>
          <thead><tr><th scope="col">座號</th><th scope="col">姓名</th><th scope="col">訂購數量</th></tr></thead>
          <tbody>{page.buyers.map((buyer) => <tr key={buyer.key}>
            <td>{buyer.seat ?? ""}</td><th scope="row">{buyer.name}</th>
            <td>{buyer.items.map((item, index) => <div key={`${item}:${index}`}>{item}</div>)}</td>
          </tr>)}</tbody>
        </table>
      </section>
    ))}</div>;
  }
  if (data.type === "classes") {
    const itemTotal = data.result.rows.reduce((total, row) => total + row.item_count, 0);
    const orderTotal = data.result.rows.reduce((total, row) => total + row.order_count, 0);
    return data.result.rows.length === 0 ? (
      <p className={styles.empty}>目前沒有符合篩選的訂單。</p>
    ) : (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className="sr-only">各班總數統計</caption>
          <thead>
            <tr>
              <th scope="col">班級</th>
              <th scope="col">訂單數</th>
              <th scope="col">商品件數</th>
              <th scope="col">訂購金額</th>
              <th scope="col">已確認收款</th>
              <th scope="col">待收金額</th>
            </tr>
          </thead>
          <tbody>
            {data.result.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td>{number(row.order_count)}</td>
                <td>{number(row.item_count)}</td>
                <td>{money(row.total_amount)}</td>
                <td>{money(row.paid_amount)}</td>
                <td>{money(row.unpaid_amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">合計</th>
              <td>{number(orderTotal)}</td>
              <td>{number(itemTotal)}</td>
              <td>{money(data.result.total_amount)}</td>
              <td>{money(data.result.paid_amount)}</td>
              <td>{money(data.result.unpaid_amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (data.type === "people") {
    const itemTotal = data.result.reduce((total, row) => total + row.quantity, 0);
    return data.result.length === 0 ? (
      <p className={styles.empty}>目前沒有符合篩選的訂購明細。</p>
    ) : (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className="sr-only">各班個人購買明細</caption>
          <thead>
            <tr>
              <th scope="col">班級</th>
              <th scope="col">訂購人</th>
              <th scope="col">商品</th>
              <th scope="col">尺寸／規格</th>
              <th scope="col">數量</th>
              <th scope="col">訂單筆數</th>
            </tr>
          </thead>
          <tbody>
            {data.result.map((row, index) => (
              <tr key={`${row.class_id ?? "none"}:${row.user_id ?? row.buyer_label}:${row.product_id}:${row.variant_key}:${index}`}>
                <td>{row.class_label}</td>
                <td>{row.buyer_label}</td>
                <td>{row.product_name}</td>
                <td>{row.variant_key}</td>
                <td>{number(row.quantity)}</td>
                <td>{number(row.order_count)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={4}>商品件數合計</th>
              <td>{number(itemTotal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  const quantityTotal = data.result.reduce((total, row) => total + row.qty_total, 0);
  const paidTotal = data.result.reduce((total, row) => total + row.qty_paid, 0);
  const productGroups = Array.from(
    data.result.reduce((groups, row) => {
      const group = groups.get(row.product_id) ?? { name: row.product_name, rows: [] as OrderQuantityRow[] };
      group.rows.push(row);
      groups.set(row.product_id, group);
      return groups;
    }, new Map<string, { name: string; rows: OrderQuantityRow[] }>()),
    ([id, group]) => ({ id, ...group }),
  );

  return data.result.length === 0 ? (
    <p className={styles.empty}>目前沒有符合篩選的商品數量。</p>
  ) : (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="sr-only">班聯商品尺寸總表</caption>
        <thead>
          <tr>
            <th scope="col">商品</th>
            <th scope="col">尺寸／規格</th>
            <th scope="col">總數</th>
            <th scope="col">已繳件數</th>
            <th scope="col">未繳件數</th>
          </tr>
        </thead>
        {productGroups.map((group) => {
          const total = group.rows.reduce((sum, row) => sum + row.qty_total, 0);
          const paid = group.rows.reduce((sum, row) => sum + row.qty_paid, 0);
          return (
            <tbody key={group.id}>
              {group.rows.map((row, index) => (
                <tr key={`${row.variant_key}:${index}`}>
                  {index === 0 && <th scope="rowgroup" rowSpan={group.rows.length + 1}>{group.name}</th>}
                  <td>{row.variant_key}</td>
                  <td>{number(row.qty_total)}</td>
                  <td>{number(row.qty_paid)}</td>
                  <td>{number(row.qty_total - row.qty_paid)}</td>
                </tr>
              ))}
              <tr className={styles.subtotal}>
                <th scope="row">商品小計</th>
                <td>{number(total)}</td>
                <td>{number(paid)}</td>
                <td>{number(total - paid)}</td>
              </tr>
            </tbody>
          );
        })}
        <tfoot>
          <tr>
            <th scope="row" colSpan={2}>全部商品合計</th>
            <td>{number(quantityTotal)}</td>
            <td>{number(paidTotal)}</td>
            <td>{number(quantityTotal - paidTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function ShopPrintReports({
  filters,
  scope,
  titleScope,
  refreshKey = 0,
  shareClassSummary = false,
  classSummary,
  classSummaryLoading = false,
}: {
  filters: ShopPurchaseReportFilters;
  scope: string;
  titleScope: string;
  refreshKey?: number;
  shareClassSummary?: boolean;
  classSummary?: OrderSummaryOut | null;
  classSummaryLoading?: boolean;
}) {
  const [reportType, setReportType] = useState<ReportType>("class-sheet");
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const reportLabel = REPORTS.find((report) => report.id === reportType)?.label ?? REPORTS[0].label;

  const downloadPdf = async () => {
    setDownloadingPdf(true);
    setDownloadError("");
    try {
      const response = await shopApi.downloadPrintReportPdf(reportType, filters, titleScope);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${reportLabel}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setDownloadError(apiErrorMessage(cause, "PDF 下載失敗"));
    } finally {
      setDownloadingPdf(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setReportData(null);

    const fail = (cause: unknown) => {
      if (!active) return;
      setError(apiErrorMessage(cause, "報表載入失敗"));
    };
    const finish = () => {
      if (active) setLoading(false);
    };

    if (reportType === "classes") {
      if (shareClassSummary) {
        if (classSummaryLoading) return () => { active = false; };
        if (classSummary) setReportData({ type: "classes", result: classSummary });
        finish();
        return () => { active = false; };
      }
      void shopApi.orderSummary({ group_by: "class", ...filters })
        .then((result) => { if (active) setReportData({ type: "classes", result }); })
        .catch(fail)
        .finally(finish);
    } else if (reportType === "class-totals") {
      setReportData({ type: "class-totals" });
      finish();
    } else if (reportType === "people" || reportType === "class-sheet") {
      void shopApi.purchaseDetails(filters)
        .then((result) => { if (active) setReportData({ type: reportType, result }); })
        .catch(fail)
        .finally(finish);
    } else {
      void shopApi.orderQuantities(filters)
        .then((result) => { if (active) setReportData({ type: "council", result }); })
        .catch(fail)
        .finally(finish);
    }

    return () => { active = false; };
  }, [classSummary, classSummaryLoading, filters, reportType, refreshKey, retryKey, shareClassSummary]);

  return (
    <section aria-label="商品統計報表" className="space-y-3">
      <div className={`card space-y-3 p-4 ${styles.screenOnly}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="block min-w-0 flex-1 text-sm font-medium text-fg-primary!" htmlFor="shop-print-report-type">
            報表類型
            <select
              id="shop-print-report-type"
              className="input mt-1 min-h-11 w-full"
              value={reportType}
              onChange={(event) => setReportType(event.target.value as ReportType)}
            >
              {REPORTS.map((report) => <option key={report.id} value={report.id}>{report.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary min-h-11 w-full sm:w-auto"
            disabled={loading || Boolean(error) || !reportData || downloadingPdf}
            onClick={() => void downloadPdf()}
          >
            <Download size={16} aria-hidden="true" />
            {downloadingPdf ? "正在產生 PDF…" : "下載 PDF"}
          </button>
        </div>
        <p className="text-sm text-fg-secondary!">報表範圍：{scope}</p>
        {downloadError && <p role="alert" className="text-sm text-danger!">{downloadError}</p>}
      </div>

      {loading && <p role="status" className="py-4 text-center text-sm text-fg-muted!">載入報表中…</p>}
      {error && (
        <div role="alert" className="rounded-lg border! border-border! p-4 text-sm text-danger!">
          <p>{error}</p>
          <button type="button" className="btn btn-ghost mt-2 min-h-11" onClick={() => setRetryKey((value) => value + 1)}>
            重新載入報表
          </button>
        </div>
      )}
      {!loading && reportData && reportData.type !== "class-totals" && (
        <section className={styles.printRoot} aria-label={reportLabel}>
          <header className={styles.header}>
            <h2>{reportLabel}</h2>
            <p>報表範圍：{scope}</p>
          </header>
          <ReportTable data={reportData} scope={scope} />
        </section>
      )}
    </section>
  );
}
