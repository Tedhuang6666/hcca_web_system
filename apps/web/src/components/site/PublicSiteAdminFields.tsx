import NumberInput from "@/components/ui/NumberInput";

export function Field({ label, children, hint }: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[var(--text-secondary)]">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const Input = props.type === "number" ? NumberInput : "input";
  return (
    <Input
      {...props}
      className={`w-full rounded-lg px-3 py-2 text-sm outline-none ${props.className ?? ""}`}
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", ...props.style }}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-28 w-full rounded-lg px-3 py-2 text-sm leading-6 outline-none ${props.className ?? ""}`}
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", ...props.style }}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg px-3 py-2 text-sm outline-none ${props.className ?? ""}`}
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", ...props.style }}
    />
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--text-secondary)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4"
      />
      {label}
    </label>
  );
}
