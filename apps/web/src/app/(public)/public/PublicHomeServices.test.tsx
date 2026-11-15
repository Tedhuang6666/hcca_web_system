import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PublicHomeServices from "./PublicHomeServices";

const { moduleStatus } = vi.hoisted(() => ({ moduleStatus: vi.fn() }));
vi.mock("@/contexts/PublicModuleStatusContext", () => ({ usePublicModuleStatus: moduleStatus }));

describe("public directory", () => {
  it("keeps the static databases when petition and election services are closed", () => {
    moduleStatus.mockReturnValue({ statuses: {} });
    render(<PublicHomeServices initialClosedModuleIds={["petitions", "elections"]} />);
    expect(screen.getByRole("link", { name: /法規資料庫/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /公文資料庫/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /財務總覽/ })).toBeVisible();
    expect(screen.queryByRole("link", { name: /陳情/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /即時開票/ })).not.toBeInTheDocument();
  });

  it("updates service visibility from the loaded module status", () => {
    moduleStatus.mockReturnValue({ statuses: { elections: { id: "elections", on: true, mode: "closed" } } });
    render(<PublicHomeServices initialClosedModuleIds={["petitions"]} />);
    expect(screen.getByRole("link", { name: /陳情中心/ })).toHaveAttribute("href", "/petitions");
    expect(screen.getByRole("link", { name: /公開陳情/ })).toHaveAttribute("href", "/petitions/public");
    expect(screen.queryByRole("link", { name: /即時開票/ })).not.toBeInTheDocument();
  });
});
