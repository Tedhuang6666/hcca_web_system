"use client";

const GRADE_OPTIONS = [
  { value: 1, label: "高一" },
  { value: 2, label: "高二" },
  { value: 3, label: "高三" },
] as const;

export default function SurveyGradeSelector({
  value,
  onChange,
}: {
  value: number[];
  onChange: (grades: number[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        限定年級（選填）
      </legend>
      <p className="text-xs leading-5" style={{ color: "var(--text-muted)" }}>
        留空代表不限年級。選擇年級後，填答者須使用有本校校務信箱的帳號，且目前班級符合所選年級。
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {GRADE_OPTIONS.map((grade) => {
          const checked = value.includes(grade.value);
          return (
            <label
              key={grade.value}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm"
              style={{
                background: checked ? "var(--primary-dim)" : "var(--bg-elevated)",
                border: `1px solid ${checked ? "var(--border-strong)" : "var(--border)"}`,
                color: checked ? "var(--primary)" : "var(--text-secondary)",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? value.filter((item) => item !== grade.value)
                      : [...value, grade.value].sort((a, b) => a - b),
                  )
                }
                className="h-4 w-4 accent-[var(--primary)]"
              />
              <span>{grade.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
