"use client";

import { useId, useState } from "react";

export default function CollectionCategoryPicker({ options, selected, onChange, disabled, label = "收款商品分類" }: {
  options: { key: string; label: string; closed?: boolean; hasUncollectedOrders?: boolean }[]; selected: string | null;
  onChange: (key: string) => void; disabled: boolean; label?: string;
}) {
  const name = useId();
  const [showClosed, setShowClosed] = useState(false);
  const closedOptions = options.filter((option) => option.closed && !option.hasUncollectedOrders);
  const visibleOptions = options.filter((option) => !option.closed || option.hasUncollectedOrders || showClosed || option.key === selected);
  return <fieldset disabled={disabled} className="min-w-0">
    <legend className="mb-2 text-sm font-semibold">{label}</legend>
    <div className="flex flex-wrap gap-2">
      {visibleOptions.map((option) => <label key={option.key} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm"
        style={{ border: "1px solid var(--border)", background: selected === option.key ? "var(--bg-elevated)" : "var(--card-bg)" }}>
        <input type="radio" name={name} checked={selected === option.key} onChange={() => onChange(option.key)} />
        {option.label}
        {option.closed && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>已結單</span>}
        {option.closed && option.hasUncollectedOrders && <span className="text-xs" style={{ color: "var(--warning)" }}>待收款</span>}
      </label>)}
    </div>
    {!visibleOptions.length && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>目前沒有未結單商品分類。</p>}
    {closedOptions.length > 0 && <button type="button" className="btn btn-ghost mt-2 min-h-11 px-3 text-sm"
      aria-expanded={showClosed} onClick={() => setShowClosed((value) => !value)}>
      {showClosed ? "收起已結單分類" : `查看已結單分類（${closedOptions.length}）`}
    </button>}
  </fieldset>;
}
