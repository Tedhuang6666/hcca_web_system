import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/core", () => ({ request, post: vi.fn(), authFetch: vi.fn() }));
vi.mock("@/components/admin/system/SystemRecentErrorsPanel", () => ({ default: () => null }));

import SystemObservabilityPanel from "./SystemObservabilityPanel";

beforeEach(() => request.mockReset());

it("錯誤分頁只載入錯誤資料，不再顯示子分頁或頁面清單", async () => {
  request.mockResolvedValue({});
  render(<SystemObservabilityPanel view="errors" />);

  await waitFor(() => expect(request).toHaveBeenCalledWith("/admin/system/observability/errors"));
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("navigation", { name: "觀測分頁" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /立即採集 PSI/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /重新整理/ })).toBeEnabled();
});

it("頁面效能分頁同時載入頁面清單與部署版本，且不重複顯示服務狀態", async () => {
  request.mockImplementation(async (path?: string) => (String(path).endsWith("/releases")
    ? [{ release: "v1.2.3", commit_sha: "abc", environment: "production", deployed_at: "2026-11-01T00:00:00Z" }]
    : { system_health: [{ name: "api", healthy: true }], pages: [] }));
  render(<SystemObservabilityPanel />);

  expect(await screen.findByText("v1.2.3")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /立即採集 PSI/ })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "服務狀態" })).not.toBeInTheDocument();
});
