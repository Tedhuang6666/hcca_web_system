import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  cacheCurrentUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("next=%2Fsurveys%2Fsurvey-1"),
}));

vi.mock("@/lib/api", () => ({ authApi: { me: mocks.me } }));
vi.mock("@/lib/auth-cache", () => ({ cacheCurrentUser: mocks.cacheCurrentUser }));

import AuthCallbackPage from "./page";

describe("AuthCallbackPage", () => {
  it("caches the authenticated user before returning to a public survey", async () => {
    const user = {
      id: "user-1",
      display_name: "校務使用者",
      email: "student@hchs.hc.edu.tw",
      permissions: [],
    };
    mocks.me.mockResolvedValue(user);

    render(<AuthCallbackPage />);

    await waitFor(() => {
      expect(mocks.me).toHaveBeenCalledTimes(1);
      expect(mocks.cacheCurrentUser).toHaveBeenCalledWith(user);
    });
  });
});
