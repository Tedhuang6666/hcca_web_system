import { afterEach, describe, expect, it, vi } from "vitest";

import { cachePurge, cacheRequest } from "./api-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("shared API requests during navigation", () => {
  afterEach(() => cachePurge());

  it("starts a fresh request when the previous page has cancelled its request", async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const caller = new AbortController();
    const first = cacheRequest("navigation/data", () => old.promise, caller.signal);
    await Promise.resolve();
    caller.abort();

    const fetchFresh = vi.fn(() => fresh.promise);
    const second = cacheRequest("navigation/data", fetchFresh);
    await Promise.resolve();
    expect(fetchFresh).toHaveBeenCalledTimes(1);

    old.resolve("old");
    fresh.resolve("fresh");
    await first;
    await expect(second).resolves.toBe("fresh");
  });

  it("keeps sharing the replacement request when an invalidated request finishes", async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const first = cacheRequest("navigation/data", () => old.promise);
    await Promise.resolve();
    cachePurge("navigation");
    const second = cacheRequest("navigation/data", () => fresh.promise);
    old.resolve("old");
    await first;

    const duplicate = vi.fn(async () => "duplicate");
    const third = cacheRequest("navigation/data", duplicate);
    await Promise.resolve();
    expect(duplicate).not.toHaveBeenCalled();

    fresh.resolve("fresh");
    await expect(second).resolves.toBe("fresh");
    await expect(third).resolves.toBe("fresh");
  });

  it("keeps a shared request alive while another page still needs it", async () => {
    const pending = deferred<string>();
    const caller = new AbortController();
    let sharedSignal: AbortSignal | undefined;
    const fetcher = vi.fn((signal: AbortSignal) => {
      sharedSignal = signal;
      return pending.promise;
    });
    const first = cacheRequest("navigation/data", fetcher, caller.signal);
    const second = cacheRequest("navigation/data", fetcher);
    await Promise.resolve();
    caller.abort();
    expect(sharedSignal?.aborted).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);

    pending.resolve("shared");
    await expect(first).resolves.toBe("shared");
    await expect(second).resolves.toBe("shared");
  });
});
