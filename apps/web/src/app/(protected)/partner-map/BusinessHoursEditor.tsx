"use client";

import { BUSINESS_HOUR_DAYS } from "@/lib/business-hours";
import type { BusinessHourDay, BusinessHours } from "@/lib/partner-map-types";

function valueFor(hours: BusinessHours, day: BusinessHourDay): { open: string; close: string } {
  const interval = hours[day]?.[0];
  return { open: interval?.open ?? "09:00", close: interval?.close ?? "18:00" };
}

export default function BusinessHoursEditor({
  value,
  onChange,
}: {
  value: BusinessHours;
  onChange: (value: BusinessHours) => void;
}) {
  return (
    <fieldset className="grid gap-2 md:col-span-2">
      <legend className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        每週營業時間 <span className="font-normal" style={{ color: "var(--text-muted)" }}>選填</span>
      </legend>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        未設定的日期不會影響顯示；設定後，營業外地圖圖標會自動變灰。
      </p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {BUSINESS_HOUR_DAYS.map(({ key, label }) => {
          const enabled = Boolean(value[key]?.length);
          const interval = valueFor(value, key);
          return (
            <div key={key} className="grid gap-2 rounded-md border p-2" style={{ borderColor: "var(--border)" }}>
              <label className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => {
                    const next = { ...value };
                    if (event.target.checked) next[key] = [interval];
                    else delete next[key];
                    onChange(next);
                  }}
                />
                {label}
              </label>
              {enabled ? (
                <div className="grid grid-cols-2 gap-1">
                  <input
                    className="input h-8 px-2 text-xs"
                    type="time"
                    aria-label={`${label} 開始時間`}
                    value={interval.open}
                    onChange={(event) => onChange({ ...value, [key]: [{ ...interval, open: event.target.value }] })}
                  />
                  <input
                    className="input h-8 px-2 text-xs"
                    type="time"
                    aria-label={`${label} 結束時間`}
                    value={interval.close}
                    onChange={(event) => onChange({ ...value, [key]: [{ ...interval, close: event.target.value }] })}
                  />
                </div>
              ) : (
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>公休</span>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
