"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import { useWS } from "@/hooks/useWS";
import type { ShopSalesAnalyticsOut, ShopSalesMetrics } from "@/lib/types";
import ShopSalesTrend from "./ShopSalesTrend";
import ShopSalesDeepAnalysis from "./ShopSalesDeepAnalysis";
import "./shop-sales-analytics.css";

const number = (value: number) =>
  value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
const money = (value: number) => `NT$${number(value)}`;
const metrics: [
  keyof ShopSalesMetrics,
  string,
  "money" | "number" | "percent",
][] = [
  ["total_amount", "訂購金額", "money"],
  ["paid_amount", "班聯已確認", "money"],
  ["unpaid_amount", "班聯未確認", "money"],
  ["order_count", "訂單數", "number"],
  ["buyer_count", "訂購人數", "number"],
  ["item_count", "商品件數", "number"],
  ["average_order_amount", "平均客單價", "money"],
  ["average_items_per_order", "平均每單件數", "number"],
  ["promotion_usage_rate", "優惠使用率", "percent"],
  ["discount_amount", "優惠折抵", "money"],
  ["payment_rate", "款項確認率", "percent"],
  ["median_order_amount", "客單價中位數", "money"],
  ["average_buyer_amount", "每人平均訂購金額", "money"],
  ["repeat_buyer_count", "多筆訂單人數", "number"],
  ["repeat_buyer_rate", "多筆訂單人數占比", "percent"],
];
const format = (value: number, kind: "money" | "number" | "percent") =>
  kind === "money"
    ? money(value)
    : `${number(value)}${kind === "percent" ? "%" : ""}`;

function exportCsv(data: ShopSalesAnalyticsOut, scope: string) {
  const rows: (string | number)[][] = [
    ["銷售分析", "起日", "迄日", "時區", "更新時間"],
    [
      "本期",
      data.current.date_from,
      data.current.date_to,
      data.timezone,
      data.generated_at,
    ],
    ["統計範圍", scope],
    ["指標", "數值"],
    ...metrics.map(([key, label]) => [label, data.current.metrics[key]]),
    [
      "期間",
      "分布",
      "項目",
      "訂單數",
      "訂購人數",
      "件數",
      "訂購金額",
      "班聯已確認",
      "累積金額",
    ],
  ];
  for (const [name, period] of [["選定區間", data.current]] as const) {
    if (!period) continue;
    for (const [key, label] of [
      ["daily", "每日"],
      ["hours", "時段"],
      ["grades", "年級"],
      ["classes", "班級"],
      ["products", "商品"],
      ["variants", "規格"],
      ["sources", "訂購方式"],
      ["weekdays", "星期"],
      ["weekday_hours", "星期與時段"],
      ["statuses", "訂單狀態（含取消退款）"],
      ["buyer_segments", "訂購頻次"],
      ["grade_products", "年級與商品"],
      ["class_products", "班級與商品"],
      ["amount_bands", "金額區間"],
      ["item_bands", "每單件數"],
    ] as const) {
      for (const row of period[key])
        rows.push([
          name,
          label,
          row.label,
          row.order_count,
          row.buyer_count,
          row.item_count,
          row.total_amount,
          row.paid_amount,
          "cumulative_amount" in row ? Number(row.cumulative_amount) : "",
        ]);
    }
  }
  // 將來源文字強制視為文字，避免試算表執行以公式字元開頭的商品名稱。
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell);
          return `"${(typeof cell === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `銷售分析_${data.current.date_from}_${data.current.date_to}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ShopSalesAnalytics({
  filters,
  refresh = 0,
  live = false,
  scope = "全部活動、全部商品",
}: {
  filters: Record<string, string>;
  refresh?: number;
  live?: boolean;
  scope?: string;
}) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [reportFormat, setReportFormat] = useState<"pdf" | "xlsx">("pdf");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [result, setResult] = useState<{
    query: string;
    data: ShopSalesAnalyticsOut;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useWS(live && autoRefresh ? "shop:orders" : null, (message) => {
    if (message.type === "order.updated") setRetry((value) => value + 1);
  });
  const query = new URLSearchParams({
    ...filters,
    compare: "false",
  }).toString();

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      setBusy(true);
      setError("");
      try {
        const data = await shopApi.salesAnalytics(
          Object.fromEntries(new URLSearchParams(query)),
        );
        if (active) setResult({ query, data });
      } catch (err) {
        if (active)
          setError(apiErrorMessage(err, "分析資料載入失敗，請重試。"));
      } finally {
        inFlight = false;
        if (active) setBusy(false);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    const interval = autoRefresh
      ? window.setInterval(onVisible, 30000)
      : undefined;
    if (autoRefresh) document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [query, refresh, retry, autoRefresh]);

  const data = result?.query === query ? result.data : null;
  const current = data?.current;
  const downloadReport = async () => {
    if (!data || reportBusy) return;
    setReportBusy(true);
    setReportError("");
    setReportMessage("");
    try {
      const response = await shopApi.downloadSalesReport({
        format: reportFormat,
        date_from: data.current.date_from,
        date_to: data.current.date_to,
        activity_id: filters.activity_id || null,
        category_id: filters.category_id || null,
        product_id: filters.product_id || null,
        class_id: filters.class_id || null,
        grade: filters.grade ? Number(filters.grade) : null,
        is_paid:
          filters.is_paid === "true"
            ? true
            : filters.is_paid === "false"
              ? false
              : null,
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const encoded = response.headers
        .get("Content-Disposition")
        ?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      link.download = encoded
        ? decodeURIComponent(encoded)
        : `銷售分析_${data.current.date_from}_${data.current.date_to}.${reportFormat}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setReportMessage(
        `${reportFormat === "pdf" ? "PDF" : "Excel"} 報告已產生並開始下載，包含產生時的篩選範圍與時間。`,
      );
    } catch (err) {
      setReportError(apiErrorMessage(err, "報告產生失敗，請重試。"));
    } finally {
      setReportBusy(false);
    }
  };

  return (
    <section className="shop-sales" aria-label="銷售分析">
      <div className="sales-toolbar">
        <h2>銷售分析</h2>
        <label>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
          />
          每 30 秒更新
        </label>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!data || busy || Boolean(error)}
          onClick={() => data && exportCsv(data, scope)}
        >
          <Download size={16} />
          匯出分析 CSV
        </button>
      </div>
      <div className="sales-report-tools" aria-label="下載分析報告">
        <div>
          <strong>產生分析報告</strong>
          <p className="sales-muted">
            依目前篩選重新產生完整圖表、分析摘要、交叉分析與明細。PDF
            適合閱讀，Excel 含各分析工作表與可編輯圖表。
          </p>
        </div>
        <label>
          報告格式
          <select
            className="input"
            aria-label="報告格式"
            value={reportFormat}
            disabled={reportBusy}
            onChange={(event) =>
              setReportFormat(event.target.value as "pdf" | "xlsx")
            }
          >
            <option value="pdf">PDF 報告</option>
            <option value="xlsx">Excel 分析活頁簿</option>
          </select>
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!data || busy || Boolean(error) || reportBusy}
          onClick={downloadReport}
        >
          <Download size={16} />
          {reportBusy ? "正在產生報告…" : "產生並下載報告"}
        </button>
      </div>
      {reportError && (
        <p role="alert" className="sales-error">
          {reportError}
        </p>
      )}
      {reportMessage && <p role="status">{reportMessage}</p>}
      <p className="sales-muted">
        日期與時段以台北時間計算。未指定日期時顯示近 30 天；每次最多 366 天。
        {live && autoRefresh && "收到訂單更新時會立即重查，並每 30 秒同步。"}
      </p>
      {error && (
        <div role="alert" className="sales-error">
          {error}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setRetry((value) => value + 1)}
          >
            重試分析
          </button>
          {data && <p>下方保留上次成功資料，尚未更新。</p>}
        </div>
      )}
      <p role="status" className="sales-muted">
        {busy
          ? "正在更新分析…"
          : data
            ? `更新時間：${new Date(data.generated_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}`
            : "等待分析資料"}
      </p>
      {current && (
        <>
          <p className="sales-period">
            資料區間 {current.date_from} — {current.date_to}
          </p>
          {!current.metrics.order_count && (
            <p className="sales-empty">
              此範圍沒有有效訂單。可調整活動、品項或日期。
            </p>
          )}
          <dl className="sales-metrics">
            {metrics.map(([key, label, kind]) => {
              const value = current.metrics[key];
              return (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{format(value, kind)}</dd>
                </div>
              );
            })}
          </dl>
          {!!data?.insights.length && (
            <section className="sales-insights" aria-label="分析摘要">
              <h3>分析摘要</h3>
              <dl>
                {data.insights.map((item) => (
                  <div key={item.title}>
                    <dt>{item.title}</dt>
                    <dd>{item.detail}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          <ShopSalesTrend current={current} />
          <ShopSalesDeepAnalysis current={current} />
          <details className="sales-detail">
            <summary>統計口徑與資料限制</summary>
            <div className="sales-notes">
              <p>
                排除測試、取消與退款訂單。訂購金額是折扣後應繳額；班聯已確認依班聯收款標記計算，班代代收尚未確認的款項仍列未確認。
              </p>
              <p>
                每日與時段依訂單建立時間歸類，件數與金額反映目前保留品項。追加、減購或取消會回算原訂單日期，這份分析不是每日異動流水帳。
              </p>
              <p>
                品項／主題篩選只統計符合的明細。訂單折扣依各明細原價比例分攤，整數餘額分配後保持整單金額一致。商品或規格的訂單數可能重疊，不能相加當總訂單數。
              </p>
              <p>
                平均客單價排除 NT$0
                訂單；優惠使用率為選取範圍內有折抵的訂單占比。年級依訂單保存的班級及該班目前年級，無班級資料列為未分班。中位數排除零元訂單；多筆訂單是同帳號於所選範圍的多張訂單，追加原單不增加筆數，不能直接解讀為回購率。
              </p>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
