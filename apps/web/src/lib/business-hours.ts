import type { BusinessHourDay, BusinessHours, BusinessHoursInterval } from "./partner-map-types";

export const BUSINESS_HOUR_DAYS: Array<{ key: BusinessHourDay; label: string }> = [
  { key: "mon", label: "週一" },
  { key: "tue", label: "週二" },
  { key: "wed", label: "週三" },
  { key: "thu", label: "週四" },
  { key: "fri", label: "週五" },
  { key: "sat", label: "週六" },
  { key: "sun", label: "週日" },
];

const DAY_KEYS: BusinessHourDay[] = BUSINESS_HOUR_DAYS.map(({ key }) => key);

function minutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function intervalsFor(hours: BusinessHours, day: BusinessHourDay): BusinessHoursInterval[] {
  return Array.isArray(hours[day]) ? hours[day]! : [];
}

export function hasBusinessHours(hours: BusinessHours | null | undefined): boolean {
  return Boolean(hours && DAY_KEYS.some((day) => intervalsFor(hours, day).length > 0));
}

export function businessOpenState(
  hours: BusinessHours | null | undefined,
  now = new Date(),
): boolean | null {
  if (!hasBusinessHours(hours)) return null;
  const dayIndex = (now.getDay() + 6) % 7;
  const today = DAY_KEYS[dayIndex];
  const previous = DAY_KEYS[(dayIndex + 6) % 7];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const isWithin = (interval: BusinessHoursInterval): boolean => {
    const open = minutes(interval.open);
    const close = minutes(interval.close);
    if (open === null || close === null) return false;
    if (close > open) return currentMinutes >= open && currentMinutes < close;
    if (close < open) return currentMinutes >= open;
    return true;
  };

  if (intervalsFor(hours!, today).some(isWithin)) return true;
  if (intervalsFor(hours!, previous).some((interval) => {
    const open = minutes(interval.open);
    const close = minutes(interval.close);
    return open !== null && close !== null && close < open && currentMinutes < close;
  })) return true;
  return false;
}

export function formatBusinessHours(hours: BusinessHours | null | undefined): string {
  if (!hasBusinessHours(hours)) return "";
  return BUSINESS_HOUR_DAYS
    .map(({ key, label }) => {
      const intervals = intervalsFor(hours!, key);
      return intervals.length > 0
        ? `${label} ${intervals.map((interval) => `${interval.open}-${interval.close}`).join("、")}`
        : `${label} 公休`;
    })
    .join(" · ");
}
