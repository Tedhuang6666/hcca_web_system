import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const metrics = vi.hoisted(() => ({ record: vi.fn(), flush: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/web-vitals", () => ({ useReportWebVitals: vi.fn() }));
vi.mock("@/lib/client-metrics", () => ({
  recordClientMetric: metrics.record,
  flushClientMetrics: metrics.flush,
}));
vi.mock("@/lib/performance-monitor", () => ({ getPerformanceMonitor: vi.fn() }));

import WebVitalsReporter from "./WebVitalsReporter";

describe("navigation timing reporting", () => {
  let timing: PerformanceNavigationTiming;

  beforeEach(() => {
    vi.useFakeTimers();
    metrics.record.mockClear();
    timing = { requestStart: 10, responseStart: 90, fetchStart: 0, loadEventEnd: 0 } as PerformanceNavigationTiming;
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([timing]);
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  });

  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
  });

  it("waits for the completed load event instead of reporting a zero duration", () => {
    render(<WebVitalsReporter />);
    expect(metrics.record).not.toHaveBeenCalledWith(expect.objectContaining({ metric: "navigation_total" }));

    fireEvent.load(window);
    expect(metrics.record).not.toHaveBeenCalledWith(expect.objectContaining({ metric: "navigation_total" }));
    Object.defineProperty(timing, "loadEventEnd", { value: 900 });
    vi.advanceTimersByTime(0);
    expect(metrics.record).toHaveBeenCalledWith({ metric: "navigation_total", value: 900, path: "/" });
    expect(metrics.record).toHaveBeenCalledWith({ metric: "navigation_ttfb", value: 80, path: "/" });
  });

  it("reports a document that has already finished loading", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    Object.defineProperty(timing, "loadEventEnd", { value: 1_200 });
    render(<WebVitalsReporter />);
    vi.advanceTimersByTime(0);
    expect(metrics.record).toHaveBeenCalledWith({ metric: "navigation_total", value: 1_200, path: "/" });
  });

  it("attributes the load to its initial route", () => {
    render(<WebVitalsReporter />);
    window.history.replaceState(null, "", "/articles");
    Object.defineProperty(timing, "loadEventEnd", { value: 900 });
    fireEvent.load(window);
    vi.advanceTimersByTime(0);
    expect(metrics.record).toHaveBeenCalledWith({ metric: "navigation_total", value: 900, path: "/" });
  });

  it("cancels reporting when unmounted before the document finishes loading", () => {
    const view = render(<WebVitalsReporter />);
    view.unmount();
    metrics.record.mockClear();
    fireEvent.load(window);
    vi.advanceTimersByTime(0);
    expect(metrics.record).not.toHaveBeenCalled();
  });
});
