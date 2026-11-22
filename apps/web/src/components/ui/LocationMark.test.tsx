import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LocationMark, { useLocationMarkScope } from "./LocationMark";

const animate = vi.fn();

function rectAt(left: number): DOMRect {
  return {
    x: left, y: 10, left, top: 10, width: 40, height: 2, right: left + 40, bottom: 12,
    toJSON: () => ({}),
  } as DOMRect;
}

function Nav({ group, active, ready = true }: { group: string; active: number | null; ready?: boolean }) {
  useLocationMarkScope(group, ready);
  return (
    <nav>
      {[0, 120, 240].map((left, index) => (
        <a key={left} href={`#${index}`} data-left={left}>
          {active === index && <LocationMark group={group} className="test-mark" />}
        </a>
      ))}
    </nav>
  );
}

beforeEach(() => {
  animate.mockReset();
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: animate,
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return rectAt(Number(this.closest("[data-left]")?.getAttribute("data-left") ?? 0));
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  document.documentElement.removeAttribute("data-a11y-motion");
  vi.unstubAllGlobals();
});

describe("LocationMark", () => {
  it("stays still on the first render", () => {
    render(<Nav group="first-render" active={0} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("glides from the previous position to the newly active item", () => {
    const view = render(<Nav group="glide" active={0} />);
    view.rerender(<Nav group="glide" active={2} />);

    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, timing] = animate.mock.calls[0];
    expect(keyframes[0].transform).toBe("translate(-240px, 0px) scale(1, 1)");
    expect(keyframes[1].transform).toBe("none");
    expect(timing.duration).toBeGreaterThanOrEqual(300);
    expect(timing.duration).toBeLessThanOrEqual(460);
  });

  it("glides across a remounted navigation, as when a public page replaces its header", () => {
    const first = render(<Nav group="remount" active={1} />);
    first.unmount();
    render(<Nav group="remount" active={0} />);

    expect(animate.mock.calls[0][0][0].transform).toBe("translate(120px, 0px) scale(1, 1)");
  });

  it("draws in place when the navigation had no current item before", () => {
    const view = render(<Nav group="arrive" active={null} />);
    view.unmount();
    render(<Nav group="arrive" active={1} />);

    const [keyframes] = animate.mock.calls[0];
    expect(keyframes[0]).toMatchObject({ opacity: 0 });
    expect(keyframes[1]).toMatchObject({ opacity: 1, transform: "none" });
  });

  it("does not treat a skeleton turning into navigation as a user move", () => {
    const view = render(<Nav group="skeleton" active={null} ready={false} />);
    view.rerender(<Nav group="skeleton" active={0} ready />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("switches without movement when reduced motion is requested", () => {
    document.documentElement.setAttribute("data-a11y-motion", "true");
    const view = render(<Nav group="reduced" active={0} />);
    view.rerender(<Nav group="reduced" active={2} />);
    expect(animate).not.toHaveBeenCalled();
  });
});
