import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-helpers";
import type { ClientErrorReceipt } from "@/lib/client-error-reporter";
import ModuleBoundary from "@/components/ModuleBoundary";
import ProtectedError from "@/app/(protected)/error";
import GlobalError from "@/app/global-error";
import RouteErrorState from "./RouteErrorState";

const { report, push } = vi.hoisted(() => ({ report: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/client-error-reporter", () => ({ reportClientError: report }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/contexts/ModuleStatusContext", () => ({ useModuleStatus: () => ({ isModuleDown: () => false }) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

beforeEach(() => {
  report.mockReset().mockResolvedValue(null);
  push.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("reports a module failure once and displays its acknowledgement in Strict Mode", async () => {
  const error = new Error("Module rendering failed");
  const receipt = { error_id: "incident-module", request_id: "request", trace_id: "trace" };
  report.mockResolvedValue(receipt);
  vi.spyOn(console, "error").mockImplementation(() => {});
  function BrokenModule(): never { throw error; }

  const { container } = render(<StrictMode><main><ModuleBoundary id="documents" skeleton={<p>Loading</p>}>
    <BrokenModule />
  </ModuleBoundary></main></StrictMode>);

  expect(await screen.findByText(receipt.error_id)).toBeVisible();
  expect(report).toHaveBeenCalledTimes(1);
  expect(container.querySelectorAll("main")).toHaveLength(1);
});

it("shows the report receipt through the protected route adapter", async () => {
  report.mockResolvedValue({ error_id: "incident-route", request_id: "request", trace_id: "trace" });
  render(<ProtectedError error={new Error("Route failed")} reset={vi.fn()} />);
  expect(await screen.findByText("incident-route")).toBeVisible();
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ scope: "protected.error" }));
});

it("ignores an earlier error's late receipt and copies the current incident", async () => {
  let finishOld!: (value: ClientErrorReceipt) => void;
  report.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValueOnce({ error_id: "incident-current", request_id: "", trace_id: "" });
  const copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: copy } });
  const oldError = new Error("Old failure");
  const current = new Error("Current failure");
  const { rerender } = render(<RouteErrorState error={oldError} reset={vi.fn()} />);
  await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
  rerender(<RouteErrorState error={current} reset={vi.fn()} />);
  expect(await screen.findByText("incident-current")).toBeVisible();
  await act(async () => { finishOld({ error_id: "incident-old", request_id: "", trace_id: "" }); });
  expect(screen.queryByText("incident-old")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "複製" }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith("incident-current"));
});

it("sends the 404 home action to the configured home instead of retrying", () => {
  const reset = vi.fn();
  render(<RouteErrorState error={new ApiError(404, "Missing")} reset={reset} homeHref="/dashboard" />);
  fireEvent.click(screen.getByRole("button", { name: "返回首頁" }));
  expect(push).toHaveBeenCalledWith("/dashboard");
  expect(reset).not.toHaveBeenCalled();
});

it("uses login and back actions for expired or forbidden requests", () => {
  const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  const reset = vi.fn();
  const { rerender } = render(<RouteErrorState error={new ApiError(401, "Expired")} reset={reset} />);
  fireEvent.click(screen.getByRole("button", { name: "前往登入" }));
  expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/));
  rerender(<RouteErrorState error={new ApiError(403, "Forbidden")} reset={reset} />);
  fireEvent.click(screen.getAllByRole("button", { name: "返回上一頁" })[0]);
  expect(back).toHaveBeenCalledOnce();
  expect(reset).not.toHaveBeenCalled();
});

it("keeps an existing code and a usable retry action if reporting fails", async () => {
  report.mockRejectedValue(new Error("Reporter unavailable"));
  const reset = vi.fn();
  render(<RouteErrorState error={new ApiError(500, "Failed", null, "backend-incident")} reset={reset} />);
  await waitFor(() => expect(report).toHaveBeenCalledOnce());
  expect(screen.getByText("backend-incident")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "重新整理" }));
  expect(reset).toHaveBeenCalledOnce();
});

it("keeps the document shell required by the global error fallback", () => {
  const html = renderToStaticMarkup(<GlobalError error={new Error("Root failed")} />);
  expect(html).toContain('<html lang="zh-TW">');
  expect(html).toContain("<body>");
  expect(html).toContain("頁面載入失敗");
});
