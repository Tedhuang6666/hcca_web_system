import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prefetch: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/login",
  useRouter: () => mocks,
}));

import NavigationProgress from "./NavigationProgress";

describe("NavigationProgress", () => {
  it("does not prefetch OAuth links", () => {
    render(<NavigationProgress />);
    const link = document.createElement("a");
    link.href = "/api/auth/google/login";
    link.dataset.noPrefetch = "true";
    document.body.append(link);

    fireEvent.pointerOver(link);

    expect(mocks.prefetch).not.toHaveBeenCalled();
  });

  it("prefetches ordinary internal links", () => {
    render(<NavigationProgress />);
    const link = document.createElement("a");
    link.href = "/dashboard";
    document.body.append(link);

    fireEvent.pointerOver(link);

    expect(mocks.prefetch).toHaveBeenCalledWith("/dashboard");
  });
});
