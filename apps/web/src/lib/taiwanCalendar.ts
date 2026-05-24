// 中華民國政府行政機關辦公日曆表（開放資料）。
// 來源：ruyut/TaiwanCalendar，透過 jsDelivr CDN 取用，支援 CORS。
// isHoliday 已內含補班/補假調整：週末補班日為 isHoliday=false，
// 平日國定假日為 isHoliday=true，description 為假日名稱（補班日為空字串）。

export interface TaiwanCalendarDay {
  date: string; // YYYYMMDD
  week: string; // 中文星期
  isHoliday: boolean;
  description: string;
}

const cache = new Map<number, Promise<Map<string, TaiwanCalendarDay>>>();

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(`${value}T00:00:00`);
}

/** 行事曆開放資料對應 key：YYYYMMDD。 */
export function taiwanCalendarKey(value: Date | string): string {
  const date = toDate(value);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

export function isWeekend(value: Date | string): boolean {
  const day = toDate(value).getDay();
  return day === 0 || day === 6;
}

export function getTaiwanCalendarStatus(
  value: Date | string,
  holidays: Map<string, TaiwanCalendarDay>,
) {
  const day = holidays.get(taiwanCalendarKey(value));
  const weekend = isWeekend(value);
  const isRestDay = day ? day.isHoliday : weekend;
  return {
    day,
    isRestDay,
    isMakeupWorkday: Boolean(day && !day.isHoliday && weekend),
    description: day?.description ?? "",
  };
}

/** 學校訂餐用：週六日一律不顯示，平日國定假日也不顯示。 */
export function isSchoolOrderingOffDay(
  value: Date | string,
  holidays: Map<string, TaiwanCalendarDay>,
): boolean {
  const day = holidays.get(taiwanCalendarKey(value));
  return isWeekend(value) || Boolean(day?.isHoliday);
}

/** 取得某年度的行事曆，回傳以 YYYYMMDD 為 key 的 Map。失敗會自動清快取以利重試。 */
export function fetchTaiwanCalendar(year: number): Promise<Map<string, TaiwanCalendarDay>> {
  const cached = cache.get(year);
  if (cached) return cached;
  const promise = (async () => {
    const res = await fetch(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`);
    if (!res.ok) throw new Error(`行事曆載入失敗（HTTP ${res.status}）`);
    const rows = (await res.json()) as TaiwanCalendarDay[];
    return new Map(rows.map((row) => [row.date, row]));
  })();
  cache.set(year, promise);
  promise.catch(() => cache.delete(year));
  return promise;
}

export async function fetchTaiwanCalendarForDates(
  values: (Date | string)[],
): Promise<Map<string, TaiwanCalendarDay>> {
  const years = Array.from(new Set(values.map((value) => toDate(value).getFullYear())));
  const maps = await Promise.all(years.map((year) => fetchTaiwanCalendar(year).catch(() => null)));
  const merged = new Map<string, TaiwanCalendarDay>();
  for (const map of maps) {
    if (map) for (const [key, value] of map) merged.set(key, value);
  }
  return merged;
}
