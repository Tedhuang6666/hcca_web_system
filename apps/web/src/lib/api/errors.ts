import { ApiError } from "../api-helpers";

export function formatErrorDetail(detail: unknown, fallback: string): string {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return String(item);
        const record = item as Record<string, unknown>;
        const msg = typeof record.msg === "string" ? record.msg : undefined;
        const loc = Array.isArray(record.loc)
          ? record.loc.filter((part) => part !== "body").join(".")
          : undefined;
        if (msg && loc) return `${loc}: ${msg}`;
        if (msg) return msg;
        return JSON.stringify(record);
      })
      .filter(Boolean);
    return messages.length ? messages.join("；") : fallback;
  }
  if (typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    for (const key of ["message", "msg", "error", "detail"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    try {
      return JSON.stringify(record);
    } catch {
      return fallback;
    }
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
  let detail: unknown = res.statusText;
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
  const message = formatErrorDetail(detail, res.statusText || "請求失敗");
  const requestId = res.headers.get("X-Request-ID");
  const codes = [
    errorId ? `錯誤代碼 ${errorId}` : null,
    requestId ? `請求代碼 ${requestId}` : null,
  ].filter(Boolean);
  return {
    message: codes.length > 0 ? `${message}（${codes.join("，")}）` : message,
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
