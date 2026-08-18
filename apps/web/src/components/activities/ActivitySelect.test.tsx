import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AUTH_CACHE_EVENT } from "@/lib/auth-cache";

const mocks = vi.hoisted(() => ({
  list: vi.fn(() => Promise.resolve([
    { id: "activity-1", name: "測試活動", status: "active", is_active: true },
  ])),
  mine: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/lib/api/activities", () => ({
  activitiesApi: {
    list: mocks.list,
    mine: mocks.mine,
  },
}));

import ActivitySelect from "./ActivitySelect";

describe("ActivitySelect", () => {
  it("does not render or fetch a public activity filter for guests", () => {
    render(
      <ActivitySelect
        value=""
        onChange={vi.fn()}
        hideWhenUnauthenticated
        scope="all"
      />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.mine).not.toHaveBeenCalled();
  });

  it("keeps the activity filter for an authenticated user", async () => {
    localStorage.setItem("user_id", "user-1");

    render(
      <ActivitySelect
        value=""
        onChange={vi.fn()}
        hideWhenUnauthenticated
        scope="all"
      />,
    );

    window.dispatchEvent(new Event(AUTH_CACHE_EVENT));
    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeVisible();
      expect(mocks.list).toHaveBeenCalledWith({ active_only: true });
    });
  });
});
