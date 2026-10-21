import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((): never => { throw new Error("redirect"); }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import CompleteProfilePage from "./page";

describe("舊班級確認網址", () => {
  it("直接導回首頁", () => {
    expect(() => CompleteProfilePage()).toThrow("redirect");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });
});
