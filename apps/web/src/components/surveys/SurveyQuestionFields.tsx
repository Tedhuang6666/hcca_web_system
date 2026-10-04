"use client";

import { Plus, X } from "lucide-react";

export const DEFAULT_MULTI_FIELD_LABELS = ["餐食 1", "餐食 2", "餐食 3", "餐食 4"];

export function SurveyGridRowsEditor({
  rows,
  onChange,
}: {
  rows: string[];
  onChange: (rows: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        列項目
      </legend>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              value={row}
              onChange={event => onChange(rows.map((value, i) => i === index ? event.target.value : value))}
              aria-label={`第 ${index + 1} 列名稱`}
              placeholder={`列 ${index + 1}`}
              className="input min-h-11"
            />
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              disabled={rows.length <= 2}
              className="topbar-icon-btn shrink-0"
              aria-label={`移除第 ${index + 1} 列`}
              style={{ opacity: rows.length <= 2 ? 0.4 : 1 }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...rows, ""])}
        disabled={rows.length >= 50}
        className="btn btn-ghost min-h-11 text-xs"
      >
        <Plus size={14} aria-hidden="true" />
        新增列
      </button>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        每一列會有一組欄位單選，至少設定 2 列。
      </p>
    </fieldset>
  );
}

export function SurveyGridColumnsEditor({
  columns,
  onChange,
}: {
  columns: string[];
  onChange: (columns: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        欄位選項
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {columns.map((column, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              value={column}
              onChange={event => onChange(columns.map((value, i) => i === index ? event.target.value : value))}
              aria-label={`第 ${index + 1} 欄名稱`}
              placeholder={`欄 ${index + 1}`}
              className="input min-h-11"
            />
            <button
              type="button"
              onClick={() => onChange(columns.filter((_, i) => i !== index))}
              disabled={columns.length <= 2}
              className="topbar-icon-btn shrink-0"
              aria-label={`移除第 ${index + 1} 欄`}
              style={{ opacity: columns.length <= 2 ? 0.4 : 1 }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...columns, ""])}
        disabled={columns.length >= 20}
        className="btn btn-ghost min-h-11 text-xs"
      >
        <Plus size={14} aria-hidden="true" />
        新增欄
      </button>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        每一列可選一個欄位，至少設定 2 列與 2 欄。
      </p>
    </fieldset>
  );
}

export function SurveyMultiFieldEditor({
  labels,
  onChange,
}: {
  labels: string[];
  onChange: (labels: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        輸入欄位名稱
      </legend>
      <div className="space-y-2">
        {labels.map((label, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              value={label}
              onChange={event => onChange(labels.map((value, i) => i === index ? event.target.value : value))}
              aria-label={`第 ${index + 1} 個欄位名稱`}
              placeholder={`欄位 ${index + 1}`}
              maxLength={500}
              className="input min-h-11"
            />
            <button
              type="button"
              onClick={() => onChange(labels.filter((_, i) => i !== index))}
              disabled={labels.length <= 2}
              className="topbar-icon-btn shrink-0"
              aria-label={`移除第 ${index + 1} 個欄位`}
              style={{ opacity: labels.length <= 2 ? 0.4 : 1 }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...labels, ""])}
        disabled={labels.length >= 20}
        className="btn btn-ghost min-h-11 text-xs"
      >
        <Plus size={14} aria-hidden="true" />
        新增欄位
      </button>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        填答者會在每個欄位分別輸入長文字。至少 2 欄，最多 20 欄。
      </p>
    </fieldset>
  );
}
