"use client";

import { useId } from "react";
import type { ProductOut } from "@/lib/types";
import styles from "./ProductSizeChart.module.css";

export default function ProductSizeChart({ product, picked = {}, onSelectOption }: {
  product: Pick<ProductOut, "size_chart" | "variant_groups">;
  picked?: Record<string, string>;
  onSelectOption?: (groupId: string, optionId: string) => void;
}) {
  const titleId = useId();
  const chart = product.size_chart;
  const group = product.variant_groups.find((group) => group.id === chart?.group_id);
  if (!chart || !group) return null;
  const rows = group.options.filter((option) => option.is_active).flatMap((option) => {
    const row = chart.rows.find((row) => row.option_id === option.id);
    return row ? [{ ...row, label: option.value }] : [];
  });
  if (rows.length === 0) return null;
  const selectedId = picked[group.id];
  const selected = rows.find((row) => row.option_id === selectedId);
  const selectedOption = group.options.find((option) => option.id === selectedId);

  return <section className={styles.chart} aria-labelledby={titleId}>
    <h4 id={titleId}>尺寸表</h4>
    <p className={styles.selection} role="status" aria-live="polite" aria-atomic="true">
      {selected
        ? `已選 ${selected.label}：${chart.columns.map((column, index) => `${column} ${selected.values[index]}`).join("、")}`
        : selectedOption ? `${selectedOption.value} 尚未提供尺寸資料。` : "選擇尺寸後，會標示對應的尺寸資料。"}
    </p>
    <div className={styles.scroll} tabIndex={0} role="region" aria-label="尺寸表，可左右捲動">
      <table>
        <caption className="sr-only">{group.name}對照表</caption>
        <thead><tr><th scope="col">{group.name}</th>
          {chart.columns.map((column) => <th scope="col" key={column}>{column}</th>)}
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.option_id} data-selected={row.option_id === selectedId}>
          <th scope="row">
            {onSelectOption ? (
              <button
                type="button"
                className={styles.option}
                aria-pressed={row.option_id === selectedId}
                onClick={() => onSelectOption(group.id, row.option_id)}>
                {row.label}{row.option_id === selectedId && <> <span className={styles.selected}>已選</span></>}
              </button>
            ) : (
              <>{row.label}{row.option_id === selectedId && <> <span className={styles.selected}>已選</span></>}</>
            )}
          </th>
          {row.values.map((value, index) => <td key={index}>{value}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    {chart.note && <p className={styles.note}>{chart.note}</p>}
  </section>;
}
