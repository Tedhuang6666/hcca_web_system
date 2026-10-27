"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import { useWS } from "@/hooks/useWS";
import type {
  ShopSalesAnalyticsOut,
  ShopSalesMetrics,
  ShopSalesRow,
} from "@/lib/types";
import "./shop-sales-analytics.css";

const number = (value: number) =>
  value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
const money = (value: number) => `NT$${number(value)}`;
type Measure =
  "order_count" | "item_count" | "total_amount" | "cumulative_amount";
const measures: [Measure, string][] = [
  ["order_count", "每日訂單"],
  ["item_count", "每日件數"],
  ["total_amount", "每日金額"],
  ["cumulative_amount", "累積金額"],
];
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
];
const format = (value: number, kind: "money" | "number" | "percent") =>
  kind === "money"
    ? money(value)
    : `${number(value)}${kind === "percent" ? "%" : ""}`;

function Distribution({
  title,
  rows,
  total,
  basis = "item_count",
}: {
  title: string;
  rows: ShopSalesRow[];
  total: number;
  basis?: "item_count" | "order_count" | "buyer_count";
}) {
  const maximum = Math.max(1, ...rows.map((row) => row[basis]));
  return (
    <section className="sales-distribution">
      <h3>{title}</h3>
      {!rows.length ? (
        <p className="sales-muted">此範圍沒有資料。</p>
      ) : (
        <div className="sales-bars">
          {rows.map((row) => (
            <div className="sales-bar-row" key={row.key}>
              <div className="sales-bar-label">
                <span>{row.label}</span>
                <span>
                  {number(row[basis])}{" "}
                  {basis === "item_count"
                    ? "件"
                    : basis === "buyer_count"
                      ? "人"
                      : "筆"}{" "}
                  · {total ? number((row[basis] / total) * 100) : 0}%
                </span>
              </div>
              <div className="sales-bar-track" aria-hidden="true">
                <div style={{ width: `${(row[basis] / maximum) * 100}%` }} />
              </div>
              <p className="sales-muted">
                {row.buyer_count} 人 · {row.order_count} 筆訂單 ·{" "}
                {money(row.total_amount)}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

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
    ["比較期", data.previous?.date_from ?? "", data.previous?.date_to ?? ""],
    ["統計範圍", scope],
    ["指標", "本期", "比較期"],
    ...metrics.map(([key, label]) => [
      label,
      data.current.metrics[key],
      data.previous?.metrics[key] ?? "",
    ]),
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
  for (const [name, period] of [
    ["本期", data.current],
    ["比較期", data.previous],
  ] as const) {
    if (!period) continue;
    for (const [key, label] of [
      ["daily", "每日"],
      ["hours", "時段"],
      ["grades", "年級"],
      ["classes", "班級"],
      ["products", "商品"],
      ["variants", "規格"],
      ["sources", "訂購方式"],
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
  const [compare, setCompare] = useState(true);
  const [compareFrom, setCompareFrom] = useState("");
  const [measure, setMeasure] = useState<Measure>("order_count");
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
    compare: String(compare),
    ...(compare && compareFrom ? { compare_from: compareFrom } : {}),
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
  const previous = data?.previous;
  const values = current?.daily.map((day) => day[measure]) ?? [];
  const oldValues = previous?.daily.map((day) => day[measure]) ?? [];
  const maximum = Math.max(1, ...values, ...oldValues);
  const points = (numbers: number[]) =>
    numbers
      .map(
        (value, index) =>
          `${40 + (index / Math.max(1, numbers.length - 1)) * 910},${200 - (value / maximum) * 170}`,
      )
      .join(" ");

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
        <label>
          <input
            type="checkbox"
            checked={compare}
            onChange={(event) => setCompare(event.target.checked)}
          />
          比較等長期間
        </label>
        {compare && (
          <label>
            比較起日
            <input
              className="input"
              type="date"
              aria-label="比較起日"
              value={compareFrom}
              onChange={(event) => setCompareFrom(event.target.value)}
            />
          </label>
        )}
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
      <p className="sales-muted">
        日期與時段以台北時間計算。未指定日期時顯示近 30 天；每次最多 366
        天。比較起日留空時，使用緊接本期之前的等長期間。
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
            本期 {current.date_from} — {current.date_to}
            {previous && (
              <span>
                比較期 {previous.date_from} — {previous.date_to}
              </span>
            )}
          </p>
          {!current.metrics.order_count && (
            <p className="sales-empty">
              此範圍沒有有效訂單。可調整活動、品項或日期；比較期資料仍可查看。
            </p>
          )}
          <dl className="sales-metrics">
            {metrics.map(([key, label, kind]) => {
              const value = current.metrics[key];
              const old = previous?.metrics[key];
              const delta =
                old === undefined
                  ? ""
                  : kind === "percent"
                    ? `${number(value - old)} 個百分點`
                    : old === 0
                      ? value === 0
                        ? "持平"
                        : "比較期為 0"
                      : `${number(((value - old) / old) * 100)}%`;
              return (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{format(value, kind)}</dd>
                  {old !== undefined && (
                    <p className="sales-muted">
                      比較期 {format(old, kind)}
                      <br />
                      變化 {delta}
                    </p>
                  )}
                </div>
              );
            })}
          </dl>
          <section className="sales-trend" aria-label="每日訂購趨勢">
            <h3>每日訂購趨勢</h3>
            <div className="sales-measures">
              {measures.map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  className="btn btn-ghost"
                  aria-pressed={measure === key}
                  onClick={() => setMeasure(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="sales-muted">
              本期為金色，比較期為灰色，依期間第幾天對齊。最高值{" "}
              {measure.includes("amount")
                ? money(
                    maximum === 1 &&
                      !values.some(Boolean) &&
                      !oldValues.some(Boolean)
                      ? 0
                      : maximum,
                  )
                : number(Math.max(0, ...values, ...oldValues))}
              ；精確數值見每日明細。
            </p>
            <svg
              viewBox="0 0 980 240"
              role="img"
              aria-label={`${measures.find(([key]) => key === measure)?.[1]}，共 ${values.length} 天`}
            >
              {[30, 115, 200].map((y) => (
                <line
                  key={y}
                  x1="40"
                  x2="950"
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                />
              ))}
              <text x="40" y="230">
                第 1 天
              </text>
              <text x="950" y="230" textAnchor="end">
                第 {values.length} 天
              </text>
              {!!oldValues.length && (
                <polyline
                  points={points(oldValues)}
                  fill="none"
                  stroke="var(--text-secondary)"
                  strokeWidth="3"
                  strokeDasharray="7 4"
                />
              )}
              <polyline
                points={points(values)}
                fill="none"
                stroke="var(--primary)"
                strokeWidth="3"
              />
              {values.length === 1 && (
                <circle
                  cx="40"
                  cy={200 - (values[0] / maximum) * 170}
                  r="5"
                  fill="var(--primary)"
                />
              )}
            </svg>
            <details>
              <summary>每日明細與比較</summary>
              <div className="sales-table-scroll">
                <table>
                  <caption className="sr-only">每日訂單、件數與金額</caption>
                  <thead>
                    <tr>
                      {[
                        "日期",
                        "訂單",
                        "件數",
                        "金額",
                        "累積金額",
                        ...(previous
                          ? ["比較日", "比較訂單", "比較件數", "比較金額"]
                          : []),
                      ].map((label) => (
                        <th key={label} scope="col">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {current.daily.map((day, index) => (
                      <tr key={day.key}>
                        <th scope="row">{day.label}</th>
                        <td>{number(day.order_count)}</td>
                        <td>{number(day.item_count)}</td>
                        <td>{money(day.total_amount)}</td>
                        <td>{money(day.cumulative_amount)}</td>
                        {previous && (
                          <>
                            <td>{previous.daily[index]?.label}</td>
                            <td>{previous.daily[index]?.order_count}</td>
                            <td>{previous.daily[index]?.item_count}</td>
                            <td>
                              {money(previous.daily[index]?.total_amount ?? 0)}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <div className="sales-distributions">
            <Distribution
              title="年級分布"
              rows={current.grades}
              total={current.metrics.buyer_count}
              basis="buyer_count"
            />
            <Distribution
              title="下單時段"
              rows={current.hours}
              total={current.metrics.order_count}
              basis="order_count"
            />
            <Distribution
              title="商品銷量"
              rows={current.products}
              total={current.metrics.item_count}
            />
            <Distribution
              title="訂購方式"
              rows={current.sources}
              total={current.metrics.order_count}
              basis="order_count"
            />
            <Distribution
              title="訂單金額分布"
              rows={current.amount_bands}
              total={current.metrics.order_count}
              basis="order_count"
            />
            <Distribution
              title="每單件數分布"
              rows={current.item_bands}
              total={current.metrics.order_count}
              basis="order_count"
            />
          </div>
          {(
            [
              ["classes", "班級明細"],
              ["variants", "商品規格明細"],
            ] as const
          ).map(([key, title]) => (
            <details className="sales-detail" key={key}>
              <summary>
                {title}（{current[key].length} 項）
              </summary>
              <div className="sales-table-scroll">
                <table>
                  <caption className="sr-only">{title}</caption>
                  <thead>
                    <tr>
                      {[
                        "項目",
                        "訂單數",
                        "訂購人數",
                        "件數",
                        "訂購金額",
                        "班聯已確認",
                      ].map((label) => (
                        <th scope="col" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {current[key].map((row) => (
                      <tr key={row.key}>
                        <th scope="row">{row.label}</th>
                        <td>{number(row.order_count)}</td>
                        <td>{number(row.buyer_count)}</td>
                        <td>{number(row.item_count)}</td>
                        <td>{money(row.total_amount)}</td>
                        <td>{money(row.paid_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
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
                訂單；優惠使用率為選取範圍內有折抵的訂單占比。年級依訂單保存的班級及該班目前年級，無班級資料列為未分班。比較期使用相同活動、商品與收款篩選，可指定去年或其他活動期間的起日。
              </p>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
