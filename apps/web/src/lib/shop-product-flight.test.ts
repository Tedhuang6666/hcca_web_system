import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanupAnimatedElement } from "./shop-product-flight";

afterEach(() => {
  vi.useRealTimers();
});

describe("shop product flight cleanup", () => {
  it("removes the flyer if the browser never dispatches an animation event", () => {
    vi.useFakeTimers();
    const flyer = document.createElement("div");
    document.body.append(flyer);

    cleanupAnimatedElement(flyer, new EventTarget() as Animation, 860);

    expect(flyer.isConnected).toBe(true);
    vi.advanceTimersByTime(860);
    expect(flyer.isConnected).toBe(false);
  });

  it("removes the flyer immediately when the animation is cancelled", () => {
    vi.useFakeTimers();
    const flyer = document.createElement("div");
    document.body.append(flyer);
    const remove = vi.spyOn(flyer, "remove");
    const animation = new EventTarget() as Animation;

    cleanupAnimatedElement(flyer, animation, 860);
    animation.dispatchEvent(new Event("cancel"));
    vi.advanceTimersByTime(860);

    expect(remove).toHaveBeenCalledOnce();
    expect(flyer.isConnected).toBe(false);
  });
});
