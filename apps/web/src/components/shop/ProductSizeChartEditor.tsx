"use client";

import { useEffect, useRef, useState } from "react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { ProductOut, ProductSizeChart as SizeChart } from "@/lib/types";
import ProductSizeChart from "./ProductSizeChart";

export default function ProductSizeChartEditor({ product, onChanged }: {
  product: Pick<ProductOut, "id" | "variant_groups" | "size_chart">;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const entryRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLSelectElement>(null);
  const restoreFocus = useRef(false);
  const group = product.variant_groups.find((group) => group.id === groupId);
  const options = group?.options.filter((option) => option.is_active) ?? [];

  useEffect(() => {
    if (error) formRef.current?.querySelector<HTMLElement>('[role="alert"]')?.focus();
  }, [error]);

  useEffect(() => {
    if (editing) groupRef.current?.focus();
    else if (restoreFocus.current) {
      entryRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);

  function edit() {
    const chart = product.size_chart;
    setGroupId(chart?.group_id ?? product.variant_groups.find((group) => group.name === "尺寸")?.id ?? product.variant_groups[0]?.id ?? "");
    setColumns(chart?.columns ?? ["衣長（cm）", "胸寬（cm）"]);
    setValues(Object.fromEntries((chart?.rows ?? []).map((row) => [row.option_id, row.values])));
    setNote(chart?.note ?? "");
    setError("");
    setMessage("");
    restoreFocus.current = true;
    setEditing(true);
  }

  async function persist(chart: SizeChart | null) {
    setBusy(true);
    setError("");
    try {
      await shopApi.updateProduct(product.id, { size_chart: chart });
      setMessage(chart ? "尺寸表已儲存。" : "尺寸表已移除。");
      setEditing(false);
      onChanged();
    } catch (error) {
      setError(apiErrorMessage(error, "尺寸表尚未儲存，請重試"));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const labels = columns.map((column) => column.trim());
    const rows = options.flatMap((option) => {
      const cells = labels.map((_, index) => values[option.id]?.[index]?.trim() ?? "");
      return cells.some(Boolean) ? [{ option_id: option.id, values: cells }] : [];
    });
    if (!group || labels.some((label) => !label) || new Set(labels).size !== labels.length) {
      setError("請選擇規格類別，並填寫不重複的欄位名稱。");
    } else if (!rows.length || rows.length > 100 || rows.some((row) => row.values.some((value) => !value))) {
      setError("請填寫 1 至 100 個尺寸的完整資料；不提供的尺寸可整列留空，單格無資料可填「—」。");
    } else {
      void persist({ group_id: group.id, columns: labels, rows, note: note.trim() || null });
      return;
    }
  }

  return <section className="card p-4 space-y-3" aria-label="商品尺寸表設定">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">商品尺寸表</h3>
      {!editing && <button ref={entryRef} type="button" className="btn btn-secondary min-h-11" onClick={edit}>
        {product.size_chart ? "編輯尺寸表" : "新增尺寸表"}
      </button>}
    </div>
    <p role="status" aria-live="polite" className={message ? "text-sm" : "sr-only"}>{message}</p>
    {!editing ? product.size_chart ? <ProductSizeChart product={product} /> :
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>設定各尺寸的測量資料，訂購時會標示所選尺寸。</p> :
      <form ref={formRef} onSubmit={(event) => { event.preventDefault(); save(); }}>
        <fieldset disabled={busy} className="space-y-4 min-w-0">
          <label className="block text-sm">對應規格類別
            <select ref={groupRef} className="input w-full mt-1" value={groupId} onChange={(event) => { setGroupId(event.target.value); setValues({}); }}>
              <option value="">請選擇規格類別</option>
              {product.variant_groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          {!product.variant_groups.length && <p className="text-sm">請先在上方新增「尺寸」規格類別與選項，再設定尺寸表。</p>}
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>欄名可包含單位。切換規格類別會清空本次未儲存的尺寸資料。</p>
          <div className="space-y-2">
            {columns.map((column, index) => <div key={index} className="flex gap-2 items-center">
              <label className="flex-1 text-sm">第 {index + 1} 欄名稱
                <input className="input w-full mt-1" maxLength={50} value={column} required
                  onChange={(event) => setColumns(columns.map((value, i) => i === index ? event.target.value : value))} />
              </label>
              <button type="button" className="btn btn-ghost min-h-11" disabled={columns.length === 1} aria-label={`移除第 ${index + 1} 欄`}
                onClick={() => {
                  setColumns(columns.filter((_, i) => i !== index));
                  setValues(Object.fromEntries(Object.entries(values).map(([id, cells]) => [id, cells.filter((_, i) => i !== index)])));
                }}>移除</button>
            </div>)}
            <button type="button" className="btn btn-secondary min-h-11" disabled={columns.length >= 8}
              onClick={() => setColumns([...columns, ""])}>新增欄位</button>
          </div>
          {options.length ? <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="編輯尺寸資料，可左右捲動">
            <table className="w-full text-sm">
              <caption className="text-left py-2">尺寸資料（不提供的尺寸可整列留空，單格無資料可填「—」）</caption>
              <thead><tr><th scope="col" className="p-2 text-left">{group?.name}</th>
                {columns.map((column, index) => <th scope="col" key={index} className="p-2 text-left">{column || `第 ${index + 1} 欄`}</th>)}
              </tr></thead>
              <tbody>{options.map((option) => <tr key={option.id}>
                <th scope="row" className="p-2 text-left whitespace-nowrap">{option.value}</th>
                {columns.map((column, index) => <td key={index} className="p-2">
                  <input className="input w-full min-w-24" maxLength={100} aria-label={`${option.value} ${column || `第 ${index + 1} 欄`}`}
                    value={values[option.id]?.[index] ?? ""} onChange={(event) => setValues({ ...values,
                      [option.id]: columns.map((_, i) => i === index ? event.target.value : values[option.id]?.[i] ?? ""),
                    })} />
                </td>)}
              </tr>)}</tbody>
            </table>
          </div> : group && <p className="text-sm">這個規格尚無可用選項，請先在上方新增尺寸選項。</p>}
          <label className="block text-sm">尺寸表備註（選填）
            <textarea className="input w-full mt-1" rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)}
              placeholder="例如：平放測量，單位為公分；實際尺寸可能有誤差。" />
          </label>
          {error && <p role="alert" tabIndex={-1} className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary min-h-11" disabled={!options.length}>{busy ? "儲存中…" : "儲存尺寸表"}</button>
            <button type="button" className="btn btn-ghost min-h-11" onClick={() => { setMessage("已取消尺寸表編輯。"); setEditing(false); }}>取消</button>
            {product.size_chart && <button type="button" className="btn btn-ghost min-h-11" onClick={() => void persist(null)}>移除尺寸表</button>}
          </div>
        </fieldset>
      </form>}
  </section>;
}
