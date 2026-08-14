import { ApiError } from "./api-helpers";

export type ErrorPresentation = {
  title: string;
  description: string;
  action: string;
  tone: "neutral" | "warning" | "danger";
};

function statusOf(error: unknown): number | null {
  if (error instanceof ApiError) return error.status;
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

export function errorPresentation(error: unknown): ErrorPresentation {
  const status = statusOf(error);
  if (status === 0) {
    return {
      title: "目前沒有網路連線",
      description: "請確認網路後再試一次；尚未送出的內容不會被系統視為完成。",
      action: "重新連線並重試",
      tone: "warning",
    };
  }
  if (status === 401) {
    return {
      title: "登入狀態已失效",
      description: "請重新登入後返回原本頁面。",
      action: "前往登入",
      tone: "warning",
    };
  }
  if (status === 403) {
    return {
      title: "目前沒有這項權限",
      description: "如果你認為這是誤判，請聯絡組織管理員並提供錯誤編號。",
      action: "返回上一頁",
      tone: "warning",
    };
  }
  if (status === 404) {
    return {
      title: "找不到這個內容",
      description: "連結可能已變更、內容已撤下，或你沒有存取這筆資料。",
      action: "返回首頁",
      tone: "neutral",
    };
  }
  if (status === 409) {
    return {
      title: "資料已被更新",
      description: "其他人可能先完成了這項操作。重新載入後確認目前狀態，再決定下一步。",
      action: "重新載入",
      tone: "warning",
    };
  }
  if (status === 422) {
    return {
      title: "請檢查輸入內容",
      description: "有欄位未符合格式或必要條件；返回表單即可修正。",
      action: "返回並修正",
      tone: "warning",
    };
  }
  if (status === 429) {
    return {
      title: "操作太頻繁",
      description: "請稍候片刻再試，系統沒有重複送出這次操作。",
      action: "稍後重試",
      tone: "warning",
    };
  }
  if (status === 503) {
    return {
      title: "服務暫時忙碌或維護中",
      description: "這個模組目前無法完成請求；其他功能仍可繼續使用。",
      action: "重新整理",
      tone: "warning",
    };
  }
  if (status !== null && status >= 500) {
    return {
      title: "服務暫時無法回應",
      description: "請稍後再試；如果持續發生，請把錯誤編號提供給支援人員。",
      action: "重新整理",
      tone: "danger",
    };
  }
  return {
    title: "頁面載入失敗",
    description: "發生未預期的問題。請重試，或先返回上一個安全位置。",
    action: "重新嘗試",
    tone: "danger",
  };
}

export function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "HCCA-UNKNOWN";
  const value = error as { errorId?: unknown; digest?: unknown };
  if (typeof value.errorId === "string" && value.errorId) return value.errorId;
  if (typeof value.digest === "string" && value.digest) return value.digest;
  return "HCCA-UNKNOWN";
}

export function isApiErrorStatus(error: unknown, status: number): boolean {
  return statusOf(error) === status;
}
