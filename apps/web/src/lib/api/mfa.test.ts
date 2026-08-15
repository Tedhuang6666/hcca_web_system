import { describe, expect, it, vi } from "vitest";

import { mfaApi } from "./mfa";

describe("mfaApi", () => {
  it("does not retry the one-time challenge exchange after a network failure", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("network failure"));

    await expect(mfaApi.exchangeChallenge()).rejects.toThrow("network failure");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
