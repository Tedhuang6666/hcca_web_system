import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cachePurge } from "@/lib/api-cache";
import { useFetch } from "./useFetch";

describe("useFetch", () => {
  afterEach(() => {
    cachePurge("use-fetch-test");
  });

  it("shows non-empty server data while revalidating in the background", async () => {
    const fetcher = vi.fn(() => Promise.resolve(["fresh"]));
    const { result } = renderHook(() => useFetch(
      fetcher,
      [],
      "載入失敗",
      ["server"],
      "use-fetch-test",
    ));

    expect(result.current).toEqual([["server"], false]);
    await waitFor(() => expect(result.current).toEqual([["fresh"], false]));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
