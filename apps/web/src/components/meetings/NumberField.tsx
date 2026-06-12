export default function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
      />
    </label>
  );
}
