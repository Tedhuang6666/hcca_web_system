import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVectorBasemap } from "./useVectorBasemap";

const network = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/lib/data-saver", () => ({ prefersReducedNetworkUsage: () => network.reduced }));
afterEach(() => { vi.unstubAllGlobals(); network.reduced = false; });

function mediaQuery(wide: boolean) {
  const media = Object.assign(new EventTarget(), { matches: wide });
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  return media;
}

describe("map rendering budget", () => {
  it("uses the lightweight layer on small screens and reacts to resizing", () => {
    const media = mediaQuery(false);
    const { result } = renderHook(() => useVectorBasemap());
    expect(result.current).toBe(false);
    act(() => { media.matches = true; media.dispatchEvent(new Event("change")); });
    expect(result.current).toBe(true);
    act(() => { media.matches = false; media.dispatchEvent(new Event("change")); });
    expect(result.current).toBe(false);
  });

  it("honors reduced data usage before mounting a vector layer", () => {
    mediaQuery(true);
    network.reduced = true;
    const { result } = renderHook(() => useVectorBasemap());
    expect(result.current).toBe(false);
    act(() => { network.reduced = false; window.dispatchEvent(new Event("hcca:low-data-mode-change")); });
    expect(result.current).toBe(true);
  });
});
