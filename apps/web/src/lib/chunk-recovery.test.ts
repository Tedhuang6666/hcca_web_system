import { afterEach, describe, expect, it, vi } from "vitest";

const chunkMessage = "Loading chunk 418 failed. (error: /_next/static/chunks/418.old.js)";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setupReporter() {
  vi.resetModules();
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  const deleteCache = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("caches", { delete: deleteCache });
  const reporter = await import("./client-error-reporter");
  return { ...reporter, fetchMock, deleteCache };
}

describe("chunk recovery", () => {
  it.each(["/_next/static/css/stale.css", "/_next/static/chunks/stale.css"])(
    "recovers a stale stylesheet and reports it if the reload does not fix it: %s",
    async (href) => {
      const { installGlobalClientErrorReporter, fetchMock, deleteCache } = await setupReporter();
      const uninstall = installGlobalClientErrorReporter();
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = href;
      document.head.append(stylesheet);
      try {
        stylesheet.dispatchEvent(new Event("error"));
        expect(deleteCache).toHaveBeenCalledTimes(1);
        expect(fetchMock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(50);

        stylesheet.dispatchEvent(new Event("error"));
        expect(deleteCache).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).scope).toBe("resource:link");
      } finally {
        uninstall();
        stylesheet.remove();
      }
    },
  );

  it("reports an external stylesheet failure without reloading", async () => {
    const { installGlobalClientErrorReporter, fetchMock, deleteCache } = await setupReporter();
    const uninstall = installGlobalClientErrorReporter();
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "https://external.example/_next/static/css/site.css";
    document.head.append(stylesheet);
    try {
      stylesheet.dispatchEvent(new Event("error"));
      expect(deleteCache).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      uninstall();
      stylesheet.remove();
    }
  });

  it.each(["global-error", "global.error", "protected.error", "route:商品訂購", "unhandledrejection"])(
    "recovers %s through the same cache and reload guard",
    async (scope) => {
      const { reportClientError, fetchMock, deleteCache } = await setupReporter();

      await expect(reportClientError({ scope, message: chunkMessage })).resolves.toBeNull();

      expect(deleteCache).toHaveBeenCalledWith("hcca-static-v5");
      expect(sessionStorage.getItem("hcca:chunk-reload-at")).not.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
    },
  );

  it("coalesces resource and boundary errors while the same reload is pending", async () => {
    const { installGlobalClientErrorReporter, reportClientError, fetchMock, deleteCache } = await setupReporter();
    const uninstall = installGlobalClientErrorReporter();
    try {
      for (const chunk of ["first", "second"]) {
        const script = document.createElement("script");
        script.src = `/_next/static/chunks/${chunk}.js`;
        document.body.append(script);
        script.dispatchEvent(new Event("error"));
      }
      await reportClientError({ scope: "protected.error", message: chunkMessage });

      expect(deleteCache).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
    } finally {
      uninstall();
    }
  });

  it("reports persistent chunk failures after the recovery reload", async () => {
    const { reportClientError, fetchMock, deleteCache } = await setupReporter();
    await reportClientError({ scope: "global.error", message: chunkMessage });
    await vi.advanceTimersByTimeAsync(50);

    await reportClientError({ scope: "global.error", message: chunkMessage });

    expect(deleteCache).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).message).toBe(chunkMessage);
  });

  it("keeps reporting usable when session storage is blocked", async () => {
    const { installGlobalClientErrorReporter, fetchMock, deleteCache } = await setupReporter();
    const uninstall = installGlobalClientErrorReporter();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    try {
      const script = document.createElement("script");
      script.src = "/_next/static/chunks/private-mode.js";
      document.body.append(script);
      script.dispatchEvent(new Event("error"));

      expect(deleteCache).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      uninstall();
    }
  });

  it("does not wait indefinitely for cache deletion before recovery", async () => {
    const { reportClientError, fetchMock, deleteCache } = await setupReporter();
    deleteCache.mockReturnValue(new Promise(() => undefined));
    await reportClientError({ scope: "protected.error", message: chunkMessage });
    await vi.advanceTimersByTimeAsync(1_000);

    await reportClientError({ scope: "protected.error", message: chunkMessage });

    expect(deleteCache).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "Loading chunk 1 failed. (error: https://external.example/_next/static/chunks/1.js)",
    "Loading chunk 1 failed. (error: /uploads/1.js)",
    "Cannot read properties of undefined",
  ])("reports errors outside the first-party chunk recovery scope: %s", async (message) => {
    const { reportClientError, fetchMock, deleteCache } = await setupReporter();

    await reportClientError({ scope: "global.error", message });

    expect(deleteCache).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
