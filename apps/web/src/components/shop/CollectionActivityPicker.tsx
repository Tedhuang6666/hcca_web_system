"use client";

export default function CollectionActivityPicker({ options, selected, onChange, disabled }: {
  options: { key: string; label: string }[]; selected: string[];
  onChange: (keys: string[]) => void; disabled: boolean;
}) {
  return <fieldset disabled={disabled} className="min-w-0">
    <legend className="mb-2 text-sm font-semibold">本次收款活動（可複選）</legend>
    <div className="flex flex-wrap gap-2">
      {options.map((option) => <label key={option.key} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm"
        style={{ border: "1px solid var(--border)", background: selected.includes(option.key) ? "var(--bg-elevated)" : "var(--card-bg)" }}>
        <input type="checkbox" checked={selected.includes(option.key)} onChange={(event) => onChange(event.target.checked
          ? [...selected, option.key] : selected.filter((key) => key !== option.key))} />
        {option.label}
      </label>)}
    </div>
    <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>只登記勾選的活動；同時收多個時，請逐項勾選。</p>
  </fieldset>;
}
