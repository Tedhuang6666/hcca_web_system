/**
 * 學餐管理頁共用工具：日期/時間轉換、貨幣格式化、班節常數。
 *
 * 從 `apps/web/src/app/meal/vendor/page.tsx` 提取，使主檔聚焦於 UI 與業務狀態。
 */

export type QuickPickupSlot = {
  label: string;
  start: string;
  end: string;
  deadline: string;
};

export const quickPickupSlots: QuickPickupSlot[] = [
  { label: "第1節下課", start: "08:50", end: "09:10", deadline: "08:20" },
  { label: "第2節下課", start: "10:00", end: "10:10", deadline: "09:30" },
  { label: "第3節下課", start: "11:00", end: "11:10", deadline: "10:30" },
  { label: "午餐／午休", start: "12:00", end: "13:05", deadline: "11:30" },
  { label: "第5節下課", start: "13:55", end: "14:05", deadline: "13:25" },
  { label: "第6節下課", start: "14:55", end: "15:10", deadline: "14:25" },
  { label: "第7節下課", start: "16:00", end: "16:10", deadline: "15:30" },
];

export const statusLabel: Record<string, string> = {
  pending_review: "待審",
  approved: "已通過",
  rejected: "已退回",
  suspended: "已停用",
};

export const orderLabel: Record<string, string> = {
  pending: "待確認",
  confirmed: "已確認",
  cancelled: "已取消",
  completed: "已完成",
};

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

export function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function datetimeLocal(date: string, time: string): string {
  return `${date}T${time}`;
}

export function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function weekdayIndex(dateString: string): number {
  const day = new Date(`${dateString}T00:00:00`).getDay();
  return day === 0 ? 6 : day - 1;
}

export function combineDateTime(dateString: string, timeString: string): string {
  return new Date(datetimeLocal(dateString, timeString)).toISOString();
}

export function money(value: number): string {
  return `NT$ ${value.toLocaleString("zh-TW")}`;
}
