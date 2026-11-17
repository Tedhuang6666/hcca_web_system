import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import ElectionCountPage from "./page";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  live: vi.fn(),
  events: vi.fn(),
  updateStatus: vi.fn(),
  reverseEvent: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ electionsApi: api }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const election = {
  id: "election-1",
  slug: null,
  title: "班聯會選舉",
  status: "live",
  ballot_boxes: [{ id: "box-1", name: "一年級票匭", status: "counting" }],
  candidates: [{ id: "cand-1", number: 1, name: "候選人甲", color: "#123456", members: [] }],
};

const summary = {
  total_votes: 12,
  valid_votes: 10,
  invalid_votes: 2,
  seats: 1,
  turnout_pct: null,
  vote_threshold_pct: null,
  candidates: [{ candidate_id: "cand-1", votes: 10 }],
};

const voteEvent = {
  id: "event-1",
  candidate_name: "候選人甲",
  delta: 5,
  ballot_box_name: "一年級票匭",
  operator_name: "開票員",
  created_at: "2026-11-17T01:00:00Z",
  reverses_event_id: null,
};

async function renderPage() {
  const params = Promise.resolve({ id: "election-1" });
  await act(async () => {
    render(
      <ConfirmProvider>
        <Suspense fallback={null}>
          <ElectionCountPage params={params} />
        </Suspense>
      </ConfirmProvider>,
    );
  });
  await screen.findByRole("heading", { name: "班聯會選舉" });
}

beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockResolvedValue(election);
  api.live.mockResolvedValue(summary);
  api.events.mockResolvedValue([voteEvent]);
  api.updateStatus.mockResolvedValue({});
  api.reverseEvent.mockResolvedValue({});
});

describe("開票控制台", () => {
  it("asks for confirmation with the current totals before closing the count", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "結束" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("目前已計 12 票");
    expect(api.updateStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "結束開票" }));
    await waitFor(() => expect(api.updateStatus).toHaveBeenCalledWith("election-1", "closed"));
  });

  it("does not close the count when the confirmation is cancelled", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "結束" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.updateStatus).not.toHaveBeenCalled();
  });

  it("confirms before reversing a recorded vote", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /紀錄/ }));
    fireEvent.click(await screen.findByRole("button", { name: /撤銷/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("候選人甲 +5");
    expect(api.reverseEvent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "撤銷" }));
    await waitFor(() => expect(api.reverseEvent).toHaveBeenCalledWith("election-1", "event-1"));
  });
});
