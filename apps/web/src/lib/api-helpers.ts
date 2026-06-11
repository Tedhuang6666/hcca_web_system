export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId?: string | null,
    public errorId?: string | null,
  ) {
    super(message);
  }
}

/** 取出 ApiError 的後端訊息，非 ApiError 時回傳 fallback 文案（toast 顯示用） */
export function apiErrorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export async function withFallback<T>(
  promise: Promise<T>,
  fallback: T,
  onError?: (error: unknown) => void,
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    onError?.(error);
    return fallback;
  }
}
