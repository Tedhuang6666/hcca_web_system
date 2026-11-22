"use client";

import { useState } from "react";
import type { ShopSalesPeriod } from "@/lib/types";

const number = (value: number) => value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
const money = (value: number) => `NT$${number(value)}`;

export default function ShopSalesVariants({ current }: { current: ShopSalesPeriod }) {
  const [productId, setProductId] = useState("");
  const [groupKey, setGroupKey] = useState("");
  const [measure, setMeasure] = useState<"item_count" | "total_amount">("item_count");
  const product = current.products.find((row) => row.key === productId) ?? current.products[0];
  const groups = new Map(current.variant_options
    .filter((row) => row.product_id === product?.key && row.group_key)
    .map((row) => [row.group_key!, row.group_name!]));
  const group = groups.has(groupKey) ? groupKey : "";
  const rows = (group ? current.variant_options : current.variants)
    .filter((row) => row.product_id === product?.key && (!group || row.group_key === group))
    .sort((a, b) => b[measure] - a[measure] || a.option_label.localeCompare(b.option_label, "zh-TW"));
  const maximum = Math.max(1, ...rows.map((row) => row[measure]));

  return (
    <section className="sales-analysis-section sales-variants" aria-label="同商品選項比較">
      <h3>同商品選項比較</h3>
      <div className="sales-analysis-controls">
        <label>
          比較商品
          <select className="input" value={product?.key ?? ""} disabled={!product}
            onChange={(event) => { setProductId(event.target.value); setGroupKey(""); }}>
            {!product && <option value="">沒有有效訂購商品</option>}
            {current.products.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
          </select>
        </label>
        <label>
          比較方式
          <select className="input" value={group} disabled={!product}
            onChange={(event) => setGroupKey(event.target.value)}>
            <option value="">完整規格組合</option>
            {[...groups].map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
        <div className="sales-measures" role="group" aria-label="選項排行依據">
          <button type="button" className="btn btn-ghost" aria-pressed={measure === "item_count"}
            onClick={() => setMeasure("item_count")}>依銷量比較</button>
          <button type="button" className="btn btn-ghost" aria-pressed={measure === "total_amount"}
            onClick={() => setMeasure("total_amount")}>依金額比較</button>
        </div>
      </div>
      {product && <p className="sales-variant-total">
        <strong>{product.label}</strong>
        <span>共 {number(product.item_count)} 件 · 訂購金額 {money(product.total_amount)}</span>
      </p>}
      {rows.length ? <>
        <ul className="sales-variant-bars" aria-label={measure === "item_count" ? "選項銷量比較" : "選項金額比較"}>
          {rows.map((row) => <li key={row.key}>
            <span>{row.option_label}</span>
            <span className="sales-variant-track" aria-hidden="true">
              <span style={{ width: `${row[measure] / maximum * 100}%` }} />
            </span>
            <strong>{measure === "item_count" ? `${number(row.item_count)} 件` : money(row.total_amount)}</strong>
          </li>)}
        </ul>
        <div className="sales-table-scroll" tabIndex={0} role="region" aria-label="選項比較明細，可橫向捲動">
          <table>
            <caption className="sr-only">{product?.label}選項比較明細</caption>
            <thead><tr>{["規格／選項", "件數", "商品內銷量占比", "訂購金額", "商品內金額占比", "訂單", "人數", "折抵金額", "班聯未確認"]
              .map((title) => <th scope="col" key={title}>{title}</th>)}</tr></thead>
            <tbody>{rows.map((row) => <tr key={row.key}>
              <th scope="row">{row.option_label}</th>
              <td>{number(row.item_count)}</td><td>{number(row.item_share)}%</td>
              <td>{money(row.total_amount)}</td><td>{number(row.amount_share)}%</td>
              <td>{number(row.order_count)}</td><td>{number(row.buyer_count)}</td>
              <td>{money(row.discount_amount)}</td><td>{money(row.total_amount - row.paid_amount)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </> : <p className="sales-empty" role="status">此範圍沒有可比較的選項。</p>}
    </section>
  );
}
