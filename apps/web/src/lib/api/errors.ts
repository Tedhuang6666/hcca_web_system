import { ApiError } from "../api-helpers";

// Pydantic 驗證錯誤的 msg 是英文並帶欄位路徑；轉成使用者看得懂的繁中說明。
const VALIDATION_MESSAGES: Record<string, string> = {
  missing: "有必填欄位尚未填寫",
  string_too_short: "內容太短",
  string_too_long: "內容超過長度上限",
  too_short: "項目數量不足",
  too_long: "項目數量超過上限",
  greater_than: "數值太小",
  greater_than_equal: "數值太小",
  less_than: "數值太大",
  less_than_equal: "數值太大",
  int_parsing: "請輸入整數",
  float_parsing: "請輸入數字",
  uuid_parsing: "資料識別碼格式不正確",
  enum: "選項不在允許範圍內",
  literal_error: "選項不在允許範圍內",
  url_parsing: "網址格式不正確",
  value_error: "輸入內容不正確",
};

const STATUS_MESSAGES: Record<number, string> = {
  400: "請求內容有誤，請檢查後再試",
  401: "登入已逾時，請重新登入",
  403: "沒有執行此操作的權限",
  404: "找不到這筆資料",
  409: "資料狀態已變更，請重新整理後再試",
  413: "檔案或內容太大",
  422: "輸入資料格式不正確",
  429: "操作太頻繁，請稍後再試",
};

export function statusMessage(status: number, fallback = "請求失敗，請稍後再試"): string {
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (status >= 500) return "系統暫時無法處理，請稍後再試";
  return fallback;
}

function validationMessage(record: Record<string, unknown>): string | null {
  const msg = typeof record.msg === "string" ? record.msg : "";
  // 自訂驗證器以 ValueError 丟出的中文訊息，Pydantic 會加上 "Value error, " 前綴。
  const custom = msg.replace(/^(Value|Assertion) error,\s*/i, "");
  if (custom !== msg && custom.trim()) return custom.trim();
  if (/[\u4e00-\u9fff]/.test(msg)) return msg;
  const type = typeof record.type === "string" ? record.type : "";
  return VALIDATION_MESSAGES[type] ?? (type ? "輸入資料格式不正確" : null);
}

export function formatErrorDetail(detail: unknown, fallback: string): string {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return String(item);
        return validationMessage(item as Record<string, unknown>) ?? "";
      })
      .filter(Boolean);
    return messages.length ? [...new Set(messages)].join("；") : fallback;
  }
  if (typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    for (const key of ["message", "msg", "error", "detail"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    // 不把原始 JSON 結構顯示給使用者。
    return fallback;
  }
  return String(detail);
}

interface ResponseErrorDetail {
  message: string;
  requestId: string | null;
  errorId: string | null;
  traceId: string | null;
}

async function errorDetailFromResponse(res: Response): Promise<ResponseErrorDetail> {
  let detail: unknown = null;
  let errorId: string | null = null;
  let traceId = res.headers.get("X-Trace-ID");
  try {
    const payload: unknown = await res.json();
    if (payload && typeof payload === "object") {
      const record = payload as { detail?: unknown; error_id?: unknown; errors?: unknown };
      detail = record.errors ?? record.detail ?? payload;
      errorId = typeof record.error_id === "string" ? record.error_id : null;
      const payloadTraceId = (payload as { trace_id?: unknown }).trace_id;
      if (!traceId && typeof payloadTraceId === "string") traceId = payloadTraceId;
    } else {
      detail = payload;
    }
  } catch {
    // 非 JSON 錯誤回應仍可用 statusText 呈現。
  }
  const message = formatErrorDetail(detail, statusMessage(res.status));
  const requestId = res.headers.get("X-Request-ID");
  return {
    // Diagnostic identifiers remain on ApiError for logging/support lookup, but
    // should not be exposed in normal user-facing error messages.
    message,
    requestId,
    errorId,
    traceId,
  };
}

export async function errorMessageFromResponse(res: Response): Promise<string> {
  return (await errorDetailFromResponse(res)).message;
}

export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const detail = await errorDetailFromResponse(res);
  return new ApiError(res.status, detail.message, detail.requestId, detail.errorId, detail.traceId);
}
