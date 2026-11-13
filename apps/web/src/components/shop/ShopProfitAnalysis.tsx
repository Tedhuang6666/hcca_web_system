"use client";

import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import NumberInput from "@/components/ui/NumberInput";
import { apiErrorMessage, shopApi } from "@/lib/api";
import type { ProductCategoryOut, ProductProcurementUpdate, ShopProfitOut, ShopProfitProduct } from "@/lib/types";
import { profitCsv, stockScenario } from "./shop-profit";
import styles from "./ShopProfitAnalysis.module.css";

const money = (value: number | null) => value == null ? "成本未設定" : `NT$${value.toLocaleString("zh-TW")}`;

function ProductPlan({ row, onSaved, onEditing }: {
  row: ShopProfitProduct;
  onSaved: () => void;
  onEditing: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProductProcurementUpdate>(row.plan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const costRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const [scenarioQuantity, setScenarioQuantity] = useState(0);
  const [scenarioPrice, setScenarioPrice] = useState(row.price);
  const quantity = Math.min(scenarioQuantity, row.sellable_stock_quantity);
  const scenario = stockScenario(row, quantity, scenarioPrice);
  useEffect(() => {
    if (editing) costRef.current?.focus();
    else if (wasEditing.current) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const fields = [
    ["minimum_order_quantity", "廠商起訂量（件）"],
    ["stock_extra_quantity", "班聯加購囤貨（件）"],
    ["reserve_quantity", "不可售備用品（件）"],
    ["supplier_gift_quantity", "廠商贈品數量（件）"],
    ["extra_cost", "額外費用（NT$）"],
  ] as const;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await shopApi.saveProcurement(row.product_id, draft);
      setEditing(false);
      onEditing(false);
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause, "採購設定儲存失敗，請重試。"));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return <article className={styles.product} aria-label={`${row.name}盈利分析`}>
    <header className={styles.productHeader}>
      <div><h3>{row.name}</h3><p>訂單 {row.ordered_quantity} 件 · 付費採購 {row.purchase_quantity} 件 · 廠商贈品 {row.plan.supplier_gift_quantity} 件</p></div>
      <strong className={row.profit_amount != null && row.profit_amount < 0 ? styles.loss : undefined}>
        <span>預估盈利</span>{money(row.profit_amount)}
      </strong>
    </header>
    <div className={styles.quantityBreakdown}>
      <span>供訂單 <b>{row.ordered_quantity}</b></span>
      <span>班聯囤貨 <b>{row.plan.stock_extra_quantity}</b></span>
      <span>不可售備品 <b>{row.plan.reserve_quantity}</b></span>
      <span>起訂補足 <b>{row.minimum_top_up_quantity}</b></span>
      <span>廠商贈品 <b>{row.plan.supplier_gift_quantity}</b></span>
      <span>可售餘貨 <b>{row.sellable_stock_quantity}</b></span>
    </div>
    <dl className={styles.rowAccounts}>
      <div><dt>折扣後訂單收入</dt><dd>{money(row.revenue)}</dd></div>
      <div><dt>整批採購成本</dt><dd>{money(row.total_cost)}</dd></div>
      <div><dt>其中：訂單選項成本</dt><dd>{money(row.option_cost)}</dd></div>
      <div><dt>其中：可售庫存成本</dt><dd>{money(row.inventory_cost)}</dd></div>
      <div><dt>其中：不可售備品成本</dt><dd>{money(row.reserve_cost)}</dd></div>
    </dl>
    {editing ? <form onSubmit={save} className={styles.editor} aria-label={`${row.name}採購設定`}>
      <fieldset disabled={busy}>
        <legend>編輯採購與成本</legend>
        <div className={styles.fields}>
          <label>單位成本（NT$；留空為未知）
            <input ref={costRef} className="input" type="number" min="0" max="2147483647" step="1"
              value={draft.unit_cost ?? ""} onChange={(e) => setDraft({ ...draft, unit_cost: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
          {fields.map(([key, label]) => <label key={key}>{label}
            <NumberInput className="input" min="0" max={key === "extra_cost" ? 2147483647 : 1000000} step="1" required
              value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.valueAsNumber })}
              aria-describedby={key === "supplier_gift_quantity" ? `supplier-gift-${row.product_id}` : undefined} />
            {key === "supplier_gift_quantity" && <span id={`supplier-gift-${row.product_id}`} className={styles.muted}>免商品本體成本，優先供訂單、再供備品；多出的列入可售餘貨。選項與額外費用仍另計。</span>}
          </label>)}
          <label className={styles.note}>採購備註
            <textarea className="input" maxLength={2000} value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="例如：備品供瑕疵替換，活動後不出售" />
          </label>
        </div>
        {row.options.length > 0 && <div className={styles.optionCosts}>
          <h4>選項額外成本</h4>
          <p className={styles.muted}>每件商品選用此選項時，另加在商品單位成本上。依有效訂單件數計算；加價選項留空為未知，無額外成本請填 0。囤貨與備品如另有選項成本，請填入額外費用。</p>
          <div className={styles.fields}>
            {row.options.map((option) => <label key={option.key}>
              {option.group_name}：{option.value} 額外單位成本（NT$）
              <input className="input" type="number" min="0" max="2147483647" step="1"
                value={(draft.option_costs ?? {})[option.key] ?? ""}
                onChange={(e) => setDraft({ ...draft, option_costs: { ...draft.option_costs,
                  [option.key]: e.target.value === "" ? null : Number(e.target.value),
                } })} />
              <span className={styles.muted}>訂單選用 {option.ordered_quantity} 件</span>
            </label>)}
          </div>
        </div>}
        <p className={styles.muted}>囤貨與備品是訂單以外的需求量；扣除廠商贈品後，不足付費起訂量時補足，餘量歸為可售庫存。額外費用可填運費、打樣或其他一次性支出。</p>
        <div className={styles.actions}>
          <button className="btn btn-primary" type="submit">{busy ? "儲存中…" : "儲存並重算"}</button>
          <button className="btn btn-ghost" type="button" onClick={() => { setEditing(false); onEditing(false); setError(""); }}>取消編輯</button>
        </div>
      </fieldset>
      {error && <p ref={errorRef} role="alert" tabIndex={-1} className={styles.loss}>{error}</p>}
    </form> : <div className={styles.planSummary}>
      <p>單位成本 {money(row.plan.unit_cost)} · 起訂 {row.plan.minimum_order_quantity} 件 · 額外費用 {money(row.plan.extra_cost)}</p>
      {row.plan.note && <p className={styles.savedNote}>{row.plan.note}</p>}
      <button ref={editRef} className="btn btn-ghost" type="button" onClick={() => { setDraft(row.plan); setEditing(true); onEditing(true); }}>編輯{row.name}採購設定</button>
    </div>}
    {row.options.length > 0 && <dl className={styles.optionSummary} aria-label={`${row.name}選項成本`}>
      {row.options.map((option) => <div key={option.key}>
        <dt>{option.group_name}：{option.value}</dt>
        <dd>每件 {money(option.unit_cost)} · {option.ordered_quantity} 件 · 合計 {money(option.total_cost)}</dd>
      </div>)}
    </dl>}
    {row.sellable_stock_quantity > 0 && <details className={styles.scenario}>
      <summary>庫存售出與回本試算 · 尚有 {row.sellable_stock_quantity} 件可售</summary>
      <p className={styles.muted}>僅模擬目前餘貨，不新增採購；備用品不列入可售量，試算結果不計入上方盈利。</p>
      <div className={styles.fields}>
        <label>模擬售出件數
          <input className="input" type="number" min="0" max={row.sellable_stock_quantity} step="1" value={quantity}
            onChange={(e) => setScenarioQuantity(Math.min(row.sellable_stock_quantity, Math.max(0, Math.floor(Number(e.target.value)))))} />
        </label>
        <label>模擬每件售價（NT$）
          <input className="input" type="number" min="0" max="2147483647" step="1" value={scenarioPrice}
            onChange={(e) => setScenarioPrice(Math.min(2147483647, Math.max(0, Math.floor(Number(e.target.value)))))} />
        </label>
      </div>
      <p aria-live="polite">新增收入 {money(scenario.extraRevenue)}；售出後盈利 <b>{money(scenario.profit)}</b>。</p>
      <p>{row.profit_amount == null ? "設定商品及已訂購選項的成本後才能計算回本。"
        : scenario.breakEvenUnits === 0 ? "目前訂單收入已足以支付整批採購成本。"
        : scenario.breakEvenUnits == null ? "售價為零，無法透過售出餘貨回本。"
        : scenario.breakEvenUnits > row.sellable_stock_quantity ? `需再售出 ${scenario.breakEvenUnits} 件才能回本，目前餘貨不足。`
        : `以此售價再售出 ${scenario.breakEvenUnits} 件即可回本。`}</p>
      <button className="btn btn-ghost" type="button" onClick={() => setScenarioQuantity(row.sellable_stock_quantity)}>試算全部餘貨售出</button>
    </details>}
  </article>;
}

export default function ShopProfitAnalysis({ refresh = 0 }: { refresh?: number }) {
  const [categories, setCategories] = useState<ProductCategoryOut[]>([]);
  const [selected, setSelected] = useState("");
  const [optionsBusy, setOptionsBusy] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [data, setData] = useState<ShopProfitOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    setOptionsBusy(true);
    setOptionsError("");
    shopApi.listCategories().then((rows) => {
      if (cancelled) return;
      setCategories(rows);
      setSelected((id) => rows.some((row) => row.id === id) ? id : rows[0]?.id ?? "");
    }).catch((cause) => {
      if (!cancelled) setOptionsError(apiErrorMessage(cause, "無法載入分析活動，請重試。"));
    }).finally(() => { if (!cancelled) setOptionsBusy(false); });
    return () => { cancelled = true; };
  }, [optionsRetry]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setBusy(true);
    setError("");
    shopApi.profitAnalysis(selected).then((result) => {
      if (!cancelled) setData(result);
    }).catch((cause) => {
      if (!cancelled) setError(apiErrorMessage(cause, "盈利分析載入失敗，請重試。"));
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [selected, revision, refresh]);
  const current = data?.category_id === selected ? data : null;
  const summary = current?.summary;
  function download() {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([profitCsv(current.products, current.category_name)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `盈利與備貨_${current.category_name}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return <section className={styles.root} aria-label="盈利與備貨">
    <header className={styles.toolbar}>
      <div><h2>盈利與備貨</h2><p>把整批採購算進來，先看目前訂單能否回本。</p></div>
      <button className="btn btn-ghost" type="button" disabled={!current || busy || Boolean(error) || editing.size > 0} onClick={download}><Download size={16} />匯出採購分析 CSV</button>
    </header>
    <div className={styles.scope}>
      <label>盈利分析活動
        <select className="input" value={selected} disabled={optionsBusy || editing.size > 0} onChange={(e) => { setSelected(e.target.value); setMessage(""); }}>
          {!categories.length && <option value="">{optionsBusy ? "載入中…" : "尚無活動"}</option>}
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      <p>計算此活動全期、全校有效訂單，排除取消、退款及測試訂單。未售庫存與備品收入以零計；即使沒有訂單，已設定的採購仍列成本。</p>
    </div>
    <p className={styles.muted}>付費採購件數＝訂單＋班聯囤貨＋不可售備品－廠商贈品，最低為 0，不足付費起訂量時補足。設定只用於採購分析，不會增加學生訂單或改動可售庫存；起訂量以每項商品合計，不依尺寸拆分。</p>
    {editing.size > 0 && <p role="status">正在編輯採購設定；請儲存或取消後再切換活動、匯出。離開此頁籤會捨棄未儲存內容。</p>}
    {optionsError && <p role="alert">{optionsError}<button className="btn btn-ghost" type="button" onClick={() => setOptionsRetry((v) => v + 1)}>重試活動</button></p>}
    {error && <p role="alert">{error}<button className="btn btn-ghost" type="button" onClick={() => setRevision((v) => v + 1)}>重試盈利分析</button>{current && "下方保留上次資料，尚未更新。"}</p>}
    <p role="status" className={styles.muted}>{busy || optionsBusy ? "正在載入盈利分析…" : message || (current ? `更新時間：${new Date(current.generated_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}` : !categories.length && !optionsError ? "尚無可分析的活動。" : "")}</p>
    {summary && <>
      <div className={styles.overview}>
        <div className={styles.balance}>
          <h3>目前訂單預估盈利</h3>
          <strong className={summary.profit_amount != null && summary.profit_amount < 0 ? styles.loss : undefined}>{money(summary.profit_amount)}</strong>
          <p>{summary.profit_amount == null ? `${summary.missing_cost_product_count} 項商品的本體或已訂購選項尚未設定成本，總盈利暫不估算。`
            : summary.profit_amount < 0 ? `距離整批回本還差 ${money(-summary.profit_amount)}。可展開商品查看庫存售出試算。`
            : "目前訂單收入已覆蓋整批採購成本。"}</p>
          <p className={styles.muted}>以應收收入估算，尚非已收現金；未填入的其他支出不包含在內。</p>
        </div>
        <dl className={styles.accounts}>
          <div><dt>折扣後訂單收入</dt><dd>{money(summary.revenue)}</dd></div>
          <div><dt>訂單商品成本（含選項）</dt><dd>− {money(summary.order_cost)}</dd></div>
          <div><dt>可售餘貨成本</dt><dd>− {money(summary.inventory_cost)}</dd></div>
          <div><dt>不可售備用品成本</dt><dd>− {money(summary.reserve_cost)}</dd></div>
          <div><dt>額外費用</dt><dd>− {money(summary.extra_cost)}</dd></div>
          <div className={styles.total}><dt>整批採購成本</dt><dd>{money(summary.total_cost)}</dd></div>
        </dl>
      </div>
      <dl className={styles.quantities}>
        <div><dt>付費採購</dt><dd>{summary.purchase_quantity} 件</dd></div>
        <div><dt>廠商贈品</dt><dd>{summary.supplier_gift_quantity} 件</dd></div>
        <div><dt>起訂補足</dt><dd>{summary.minimum_top_up_quantity} 件</dd></div>
        <div><dt>可售餘貨</dt><dd>{summary.sellable_stock_quantity} 件</dd></div>
        <div><dt>不可售備品</dt><dd>{summary.reserve_quantity} 件</dd></div>
      </dl>
      <p className={styles.cash}>班聯已確認收款 <b>{money(summary.paid_amount)}</b> · 未確認 <b>{money(summary.unpaid_amount)}</b> · 已確認收款減整批成本 <b>{money(summary.cash_balance)}</b>。此為資金需求估算，未追蹤實際支付廠商款項。</p>
      <h3 className={styles.sectionTitle}>逐商品採購與分析</h3>
      {!current.products.length && <p>此活動尚無商品，請先到商品管理建立商品。</p>}
      {current.products.map((row) => <ProductPlan key={row.product_id} row={row}
        onEditing={(active) => setEditing((ids) => { const next = new Set(ids); if (active) next.add(row.product_id); else next.delete(row.product_id); return next; })}
        onSaved={() => { setMessage(`${row.name}採購設定已儲存。`); setRevision((v) => v + 1); }} />)}
      <button className="btn btn-ghost" type="button" disabled={busy || editing.size > 0} onClick={() => { setMessage(""); setRevision((v) => v + 1); }}><RefreshCw size={16} />更新訂單與盈利</button>
    </>}
  </section>;
}
