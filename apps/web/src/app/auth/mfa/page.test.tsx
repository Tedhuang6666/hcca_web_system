import { StrictMode } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeChallenge: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", () => ({
  apiErrorMessage: vi.fn(),
  authApi: { me: vi.fn() },
  mfaApi: {
    exchangeChallenge: mocks.exchangeChallenge,
    verifyLogin: vi.fn(),
    authenticationOptions: vi.fn(),
    verifyAuthentication: vi.fn(),
  },
}));

vi.mock("@/lib/auth-cache", () => ({ cacheCurrentUser: vi.fn() }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn() }));

import MFALoginPage from "./page";

describe("MFALoginPage", () => {
  it("exchanges the one-time challenge only once under Strict Mode", async () => {
    mocks.exchangeChallenge.mockResolvedValue({
      challenge: "challenge-token",
      passkey_available: false,
    });

    render(
      <StrictMode>
        <MFALoginPage />
      </StrictMode>,
    );

    await waitFor(() => expect(mocks.exchangeChallenge).toHaveBeenCalledTimes(1));
  });
});
