import { describe, expect, it, vi } from "vitest";

import { reportClientError } from "./client-error-reporter";
import { ApiError, apiErrorMessage, withFallback } from "./api-helpers";
import { request } from "./api/core";
import { apiErrorFromResponse } from "./api/errors";
import { fetchWithRetry, uploadWithProgress } from "./api/transport";
import { PERMISSION_DENIED_EVENT, type PermissionDeniedDetail } from "./permission-events";

vi.mock("./client-error-reporter", () => ({ reportClientError: vi.fn() }));

describe("API helpers", () => {
  it("returns successful values without invoking the error hook", async () => {
    const onError = vi.fn();

    await expect(withFallback(Promise.resolve("ok"), "fallback", onError)).resolves.toBe(
      "ok",
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns a fallback and reports the original error", async () => {
    const error = new Error("offline");
    const onError = vi.fn();

    await expect(withFallback(Promise.reject(error), [], onError)).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("keeps request correlation fields on API errors", () => {
    const error = new ApiError(503, "服務暫時不可用", "request-1", "error-1");

    expect(error.status).toBe(503);
    expect(error.requestId).toBe("request-1");
    expect(error.errorId).toBe("error-1");
  });

  it("uses backend messages only for ApiError instances", () => {
    expect(apiErrorMessage(new ApiError(422, "欄位格式錯誤"), "通用錯誤")).toBe("欄位格式錯誤");
    expect(apiErrorMessage(new Error("internal detail"), "通用錯誤")).toBe("通用錯誤");
  });

  it("does not expose diagnostic codes in user-facing API errors", async () => {
    const response = new Response(JSON.stringify({
      detail: "此問卷僅限校務帳號填答",
      error_id: "error-1",
    }), {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": "request-1",
      },
    });

    const error = await apiErrorFromResponse(response);
    expect(error.message).toBe("此問卷僅限校務帳號填答");
    expect(error.errorId).toBe("error-1");
    expect(error.requestId).toBe("request-1");
  });

  it("announces a standard 403 so the shell can refresh permissions", async () => {
    const listener = vi.fn();
    window.addEventListener(PERMISSION_DENIED_EVENT, listener);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: "需要權限：document:create",
    }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(request("/documents")).rejects.toMatchObject({ status: 403 });

    const event = listener.mock.calls[0]?.[0] as CustomEvent<PermissionDeniedDetail>;
    expect(event.detail).toEqual({ path: "/documents", message: "需要權限：document:create" });
    window.removeEventListener(PERMISSION_DENIED_EVENT, listener);
    vi.unstubAllGlobals();
  });

  it("does not report an already-counted circuit-open state as another client error", async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: "backend unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(request("/test/circuit-open")).rejects.toMatchObject({ status: 503 });
    }
    await expect(request("/test/circuit-open")).rejects.toMatchObject({ status: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("does not open the circuit for intentional protective responses", async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({
            detail: "此功能模組系統關閉中",
            module_maintenance: true,
            module_closed: true,
          }), {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "X-HCCA-Protective-Response": "1",
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(request("/test/protective-response")).rejects.toMatchObject({ status: 503 });
    }

    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.unstubAllGlobals();
  });

  it("fails a stalled request after the client timeout", async () => {
    vi.mocked(reportClientError).mockClear();
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(
      (input: string, init: RequestInit) => {
        if (input === "/api/analytics/client-metrics/batch") return Promise.resolve(new Response(null, { status: 202 }));
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = request("/test/stalled-request");
    const assertion = expect(pending).rejects.toMatchObject({ status: 0 });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(fetchMock.mock.calls.filter(([input]) => input === "/api/test/stalled-request")).toHaveLength(1);
    expect(reportClientError).toHaveBeenCalledWith(expect.objectContaining({
      scope: "api.timeout",
      diagnostics: expect.objectContaining({
        failure_kind: "timeout",
        request_method: "GET",
        request_path: "/test/stalled-request",
        request_attempts: 1,
        request_timeout_ms: 15_000,
      }),
    }));

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the request timeout active while the response body is still streaming", async () => {
    vi.mocked(reportClientError).mockClear();
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(
      (input: string, init: RequestInit) => {
        if (input === "/api/analytics/client-metrics/batch") {
          return Promise.resolve(new Response(null, { status: 202 }));
        }
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("Aborted", "AbortError"));
            }, { once: true });
          },
        });
        return Promise.resolve(new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = request("/test/stalled-body");
    const assertion = expect(pending).rejects.toThrow("後端 API 回應逾時（15 秒）");
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(reportClientError).toHaveBeenCalledWith(expect.objectContaining({
      scope: "api.timeout",
      diagnostics: expect.objectContaining({
        failure_kind: "timeout",
        request_method: "GET",
        request_path: "/test/stalled-body",
        request_attempts: 1,
        request_timeout_ms: 15_000,
      }),
    }));

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports network failures with a query-free API path and retry context", async () => {
    vi.mocked(reportClientError).mockClear();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(
      fetchWithRetry("/shop/products?search=private", { method: "POST" }, {}, 0),
    ).rejects.toThrow("無法連線至後端 API");

    expect(reportClientError).toHaveBeenCalledWith(expect.objectContaining({
      scope: "api.network",
      diagnostics: {
        failure_kind: "network",
        request_method: "POST",
        request_path: "/shop/products",
        request_attempts: 1,
        request_timeout_ms: 30_000,
      },
    }));
    vi.unstubAllGlobals();
  });

  it("does not wrap a no-content status with a response body", async () => {
    const response = new Response("unexpected body", { status: 200 });
    Object.defineProperty(response, "status", { value: 204 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/test/no-content")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.filter(([input]) => input === "/api/test/no-content")).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it("creates a bodyless response when an upload returns 204", async () => {
    const handlers: { onload?: () => void } = {};
    const xhr = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(() => handlers.onload?.()),
      getAllResponseHeaders: vi.fn(() => ""),
      upload: { addEventListener: vi.fn() },
      status: 204,
      statusText: "No Content",
      responseText: "",
    };
    Object.defineProperty(xhr, "onload", {
      set: (handler: (() => void) | null) => { handlers.onload = handler ?? undefined; },
    });
    const xhrConstructor = vi.fn(function MockXMLHttpRequest() { return xhr; });
    vi.stubGlobal("XMLHttpRequest", xhrConstructor);

    const pending = uploadWithProgress("/api/test/upload", { method: "POST" }, () => undefined);
    const response = await pending;

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    vi.unstubAllGlobals();
  });

  it("treats a 401 after refresh as an expired session", async () => {
    localStorage.setItem("user_id", "user-401-retry");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "expired" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/auth-me-retry")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    localStorage.removeItem("user_id");
  });

  it("does not refresh a 401 for a visitor without a local session", async () => {
    localStorage.removeItem("user_id");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/protected-as-visitor")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
