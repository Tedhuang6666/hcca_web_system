import { StrictMode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cachePurge } from "@/lib/api-cache";
import { useFetch } from "./useFetch";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("useFetch navigation recovery", () => {
  afterEach(() => cachePurge("navigation-test"));

  it("recovers after an effect is immediately cleaned up and restarted", async () => {
    const fetcher = vi.fn(async (signal?: AbortSignal) => {
      if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
      return ["fresh"];
    });
    const { result } = renderHook(
      () => useFetch(fetcher, [], "載入失敗", [], "navigation-test"),
      { wrapper: StrictMode },
    );

    await waitFor(() => expect(result.current).toEqual([["fresh"], false]));
  });
});
