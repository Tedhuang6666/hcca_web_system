"use client";

import { useMemo, useState } from "react";
import type { ShopSalesCrossRow, ShopSalesPeriod } from "@/lib/types";

const number = (value: number) =>
  value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
const money = (value: number) => `NT$${number(value)}`;
const dimensions = [
  ["products", "商品"],
  ["grades", "年級"],
  ["classes", "班級"],
  ["variants", "規格"],
  ["sources", "訂購方式"],
  ["weekdays", "星期"],
  ["hours", "下單時段"],
  ["statuses", "訂單狀態（含取消退款）"],
  ["buyer_segments", "訂購頻次"],
  ["amount_bands", "訂單金額區間"],
  ["item_bands", "每單件數區間"],
] as const;
type Dimension = (typeof dimensions)[number][0];
type Sort = "total_amount" | "item_count" | "buyer_count" | "unpaid";
type CrossMeasure = "item_count" | "total_amount" | "buyer_count";
export default function ShopSalesDeepAnalysis({
  current,
}: {
  current: ShopSalesPeriod;
}) {
  const [dimension, setDimension] = useState<Dimension>("products");
  const [sort, setSort] = useState<Sort>("total_amount");
  const [ascending, setAscending] = useState(false);
  const [search, setSearch] = useState("");
  const [crossBy, setCrossBy] = useState<"grade_products" | "class_products">(
    "grade_products",
  );
  const [crossMeasure, setCrossMeasure] = useState<CrossMeasure>("item_count");
  const [selected, setSelected] = useState("");
  const [heatMeasure, setHeatMeasure] = useState<
    "order_count" | "total_amount"
  >("order_count");
  const rows = useMemo(() => {
    const result = current[dimension].map((row) => ({ row }));
    const value = (entry: (typeof result)[number]) =>
      sort === "unpaid"
        ? entry.row.total_amount - entry.row.paid_amount
        : entry.row[sort];
    return result
      .filter(({ row }) =>
        row.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      )
      .sort(
        (a, b) =>
          (value(a) - value(b)) * (ascending ? 1 : -1) ||
          a.row.label.localeCompare(b.row.label, "zh-TW"),
      );
  }, [current, dimension, search, sort, ascending]);
  const rowTotal = current[dimension].reduce(
    (total, row) => total + row.total_amount,
    0,
  );
  const cross = current[crossBy];
  const allCross = cross;
  const productNames = new Map(
    allCross.map((row) => [row.product_id, row.product_name]),
  );
  const dimensionNames = new Map(
    allCross.map((row) => [row.dimension_key, row.dimension_label]),
  );
  const crossMap = new Map(cross.map((row) => [row.key, row]));
  const selectedRow = crossMap.get(selected);
  const maximum = Math.max(1, ...cross.map((row) => row[crossMeasure]));
  const heat = new Map(
    current.weekday_hours.map((row) => [Number(row.key), row]),
  );
  const heatMax = Math.max(
    1,
    ...current.weekday_hours.map((row) => row[heatMeasure]),
  );
  const [heatActive, setHeatActive] = useState<number | null>(null);
  const cellValue = (row?: ShopSalesCrossRow) =>
    crossMeasure === "total_amount"
      ? money(row?.[crossMeasure] ?? 0)
      : number(row?.[crossMeasure] ?? 0);
  return (
    <div className="sales-deep-analysis">
      <section className="sales-analysis-section" aria-label="分項分析與排行">
        <h3>分項分析與排行</h3>
        <div className="sales-analysis-controls">
          <label>
            分析項目
            <select
              className="input"
              value={dimension}
              onChange={(event) => {
                setDimension(event.target.value as Dimension);
                setSearch("");
              }}
            >
              {dimensions.map(([key, title]) => (
                <option key={key} value={key}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            排序依據
            <select
              className="input"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
            >
              <option value="total_amount">訂購金額</option>
              <option value="item_count">商品件數</option>
              <option value="buyer_count">訂購人數</option>
              <option value="unpaid">班聯未確認金額</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn-ghost"
            aria-pressed={ascending}
            onClick={() => setAscending((value) => !value)}
          >
            {ascending ? "由小到大" : "由大到小"}
          </button>
          <label>
            搜尋項目
            <input
              className="input"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="商品、規格、班級…"
            />
          </label>
        </div>
        <p className="sales-muted">
          可按金額、件數、人數或未確認款項排序。占比以目前分析項目的訂購金額合計計算；訂單與人數可能跨項重疊。取消／退款金額另列，不代表實際退款撥付額。
        </p>
        <div className="sales-table-scroll">
          <table>
            <caption className="sr-only">分項分析與排行明細</caption>
            <thead>
              <tr>
                {[
                  "項目",
                  "訂單",
                  "人數",
                  "件數",
                  "訂購金額",
                  "金額占比",
                  "每單金額",
                  "每人金額",
                  "折抵金額",
                  "班聯未確認",
                  "確認率",
                ].map((title) => (
                  <th scope="col" key={title}>
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row }) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{number(row.order_count)}</td>
                  <td>{number(row.buyer_count)}</td>
                  <td>{number(row.item_count)}</td>
                  <td>{money(row.total_amount)}</td>
                  <td>
                    {rowTotal ? number((row.total_amount / rowTotal) * 100) : 0}
                    %
                  </td>
                  <td>
                    {money(
                      row.order_count ? row.total_amount / row.order_count : 0,
                    )}
                  </td>
                  <td>
                    {money(
                      row.buyer_count ? row.total_amount / row.buyer_count : 0,
                    )}
                  </td>
                  <td>{money(row.discount_amount)}</td>
                  <td>{money(row.total_amount - row.paid_amount)}</td>
                  <td>
                    {row.total_amount
                      ? `${number((row.paid_amount / row.total_amount) * 100)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p role="status" className="sales-empty">
            沒有符合搜尋的項目。
          </p>
        )}
      </section>

      <section className="sales-analysis-section" aria-label="商品交叉分析">
        <h3>年級／班級 × 商品</h3>
        <div className="sales-analysis-controls">
          <label>
            交叉分類
            <select
              className="input"
              value={crossBy}
              onChange={(event) => {
                setCrossBy(event.target.value as typeof crossBy);
                setSelected("");
              }}
            >
              <option value="grade_products">年級 × 商品</option>
              <option value="class_products">班級 × 商品</option>
            </select>
          </label>
          <label>
            交叉指標
            <select
              className="input"
              value={crossMeasure}
              onChange={(event) =>
                setCrossMeasure(event.target.value as CrossMeasure)
              }
            >
              <option value="item_count">件數</option>
              <option value="total_amount">訂購金額</option>
              <option value="buyer_count">訂購人數</option>
            </select>
          </label>
        </div>
        <p className="sales-muted">
          點選格子查看該年級／班級的品項完整明細；顏色深淺以本期指標相對值呈現。手機可左右捲動。
        </p>
        {allCross.length ? (
          <div className="sales-table-scroll">
            <table className="sales-cross-table">
              <caption className="sr-only">商品交叉分析矩陣</caption>
              <thead>
                <tr>
                  <th scope="col">
                    {crossBy === "grade_products" ? "年級" : "班級"}
                  </th>
                  {[...productNames].map(([id, name]) => (
                    <th scope="col" key={id}>
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...dimensionNames]
                  .sort(([a], [b]) =>
                    a.localeCompare(b, "zh-TW", { numeric: true }),
                  )
                  .map(([key, name]) => (
                    <tr key={key}>
                      <th scope="row">{name}</th>
                      {[...productNames].map(([id, product]) => {
                        const cellKey = `${key}:${id}`;
                        const row = crossMap.get(cellKey);
                        return (
                          <td key={id}>
                            <button
                              type="button"
                              className="sales-cross-cell"
                              aria-pressed={selected === cellKey}
                              aria-label={`${name} × ${product}，${cellValue(row)}`}
                              style={{
                                background: `color-mix(in srgb, var(--primary) ${Math.round(8 + ((row?.[crossMeasure] ?? 0) / maximum) * 45)}%, var(--card-bg))`,
                              }}
                              onClick={() => setSelected(cellKey)}
                            >
                              {cellValue(row)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sales-empty">此範圍沒有商品交叉資料。</p>
        )}
        {selected && (
          <div className="sales-cross-detail" role="status">
            <strong>{selectedRow?.label ?? "此格沒有有效訂單"}</strong>
            <p>
              本期 {selectedRow?.order_count ?? 0} 筆 ·{" "}
              {selectedRow?.buyer_count ?? 0} 人 ·{" "}
              {selectedRow?.item_count ?? 0} 件 ·{" "}
              {money(selectedRow?.total_amount ?? 0)}；班聯未確認{" "}
              {money(
                (selectedRow?.total_amount ?? 0) -
                  (selectedRow?.paid_amount ?? 0),
              )}
            </p>
          </div>
        )}
      </section>

      <section className="sales-analysis-section" aria-label="星期與時段熱區">
        <h3>星期 × 下單時段</h3>
        <div className="sales-analysis-controls">
          <label>
            熱區指標
            <select
              className="input"
              value={heatMeasure}
              onChange={(event) =>
                setHeatMeasure(event.target.value as typeof heatMeasure)
              }
            >
              <option value="order_count">訂單數</option>
              <option value="total_amount">訂購金額</option>
            </select>
          </label>
          <p className="sales-muted">
            統計所選區間的總量；尚未校正各星期出現的次數，不直接代表每個營業日的平均表現。
          </p>
        </div>
        <div className="sales-table-scroll">
          <table className="sales-heatmap">
            <caption className="sr-only">台北時間星期與下單時段熱區</caption>
            <thead>
              <tr>
                <th scope="col">星期</th>
                {Array.from({ length: 24 }, (_, hour) => (
                  <th scope="col" key={hour}>
                    {hour}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 7 }, (_, day) => (
                <tr key={day}>
                  <th scope="row">週{"一二三四五六日"[day]}</th>
                  {Array.from({ length: 24 }, (_, hour) => {
                    const row = heat.get(day * 24 + hour);
                    const value = row?.[heatMeasure] ?? 0;
                    return (
                      <td key={hour}>
                        <button
                          type="button"
                          title={`${row?.label ?? ""}：${number(value)}`}
                          aria-label={`週${"一二三四五六日"[day]} ${hour}:00，${heatMeasure === "total_amount" ? money(value) : `${number(value)} 筆`}`}
                          style={{
                            background: `color-mix(in srgb, var(--primary) ${Math.round(5 + (value / heatMax) * 60)}%, var(--card-bg))`,
                          }}
                          onClick={() => setHeatActive(day * 24 + hour)}
                        >
                          {value
                            ? heatMeasure === "total_amount"
                              ? number(value / 1000) + "k"
                              : number(value)
                            : "·"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {heatActive !== null && (
          <p role="status">
            {heat.get(heatActive)?.label}：
            {heat.get(heatActive)?.order_count ?? 0} 筆、
            {heat.get(heatActive)?.item_count ?? 0} 件、
            {money(heat.get(heatActive)?.total_amount ?? 0)}
          </p>
        )}
      </section>
    </div>
  );
}
