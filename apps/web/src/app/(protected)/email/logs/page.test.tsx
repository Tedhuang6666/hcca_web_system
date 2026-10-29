import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { authApi, emailApi } from "@/lib/api";
import type { EmailMessageOut } from "@/lib/types";
import EmailLogsPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/api", () => ({
  authApi: { me: vi.fn() },
  emailApi: { listMessages: vi.fn(), listTemplates: vi.fn(), resendMessage: vi.fn() },
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock("@/components/ui/targeting", () => ({ useOrgOptions: () => [] }));
vi.mock("@/components/ui/SmartEmptyState", () => ({ default: () => null }));
vi.mock("@/components/ui/AnimatedDownloadButton", () => ({ default: () => null }));
vi.mock("@/components/ui/Modal", () => ({ default: () => null }));
vi.mock("@/components/ui/Skeleton", () => ({ ListPageSkeleton: () => null }));

const NOW = Date.parse("2026-10-29T04:00:00Z");
const CUTOFF = "2026-10-26T04:00:00.000Z";
const USER = {
  id: "current-user",
  display_name: "測試管理員",
  email: "admin@example.org",
  permissions: ["email:send", "email:view_logs"],
  is_superuser: true,
};

function message(id: string, senderId: string | null): EmailMessageOut {
  return {
    id,
    sender_id: senderId,
    sender_name: senderId ? "寄件者" : null,
    subject: `未送達郵件 ${id}`,
    template: "generic",
    recipient_count: 1,
    recipient_preview: [],
    status: "failed",
    scheduled_at: null,
    created_at: "2026-10-28T04:00:00Z",
    updated_at: "2026-10-28T04:00:00Z",
    org_id: null,
    template_id: null,
    track_opens: false,
    track_clicks: false,
  };
}

const SYSTEM_MESSAGE = message("system-notification", null);
const OTHER_MESSAGE = message("other-sender", "other-user");
const OWN_MESSAGE = message("own-message", USER.id);

function recentQueries() {
  return vi.mocked(emailApi.listMessages).mock.calls
    .map(([params]) => params)
    .filter((params) => params?.date_from);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(authApi.me).mockResolvedValue(USER);
  vi.mocked(emailApi.listTemplates).mockResolvedValue([]);
  vi.mocked(emailApi.listMessages).mockResolvedValue([]);
  vi.mocked(emailApi.resendMessage).mockResolvedValue({ ...OWN_MESSAGE, status: "queued" });
});

describe("recent email batch resend", () => {
  it("includes system notifications and other senders for a superuser", async () => {
    vi.mocked(emailApi.listMessages).mockImplementation(async (params) => {
      if (!params?.date_from || params.status !== "failed" || params.mine) return [];
      return [SYSTEM_MESSAGE, OTHER_MESSAGE];
    });
    render(<EmailLogsPage />);

    fireEvent.click(screen.getByRole("button", { name: "批次重新寄送近三天" }));

    await waitFor(() => expect(emailApi.resendMessage).toHaveBeenCalledTimes(2));
    expect(emailApi.resendMessage).toHaveBeenCalledWith(SYSTEM_MESSAGE.id);
    expect(emailApi.resendMessage).toHaveBeenCalledWith(OTHER_MESSAGE.id);
    expect(recentQueries()).toHaveLength(5);
    for (const params of recentQueries()) {
      expect(params).toMatchObject({ date_from: CUTOFF, mine: false });
    }
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("2 封"));
    expect(toast.info).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps non-superusers within their own mail (owner=%s)", async (isOwner) => {
    vi.mocked(authApi.me).mockResolvedValue({ ...USER, is_superuser: false, is_owner: isOwner });
    vi.mocked(emailApi.listMessages).mockImplementation(async (params) => {
      if (!params?.date_from || params.status !== "failed") return [];
      return params.mine ? [OWN_MESSAGE] : [OWN_MESSAGE, SYSTEM_MESSAGE, OTHER_MESSAGE];
    });
    render(<EmailLogsPage />);

    fireEvent.click(screen.getByRole("button", { name: "批次重新寄送近三天" }));

    await waitFor(() => expect(emailApi.resendMessage).toHaveBeenCalledOnce());
    expect(emailApi.resendMessage).toHaveBeenCalledWith(OWN_MESSAGE.id);
    for (const params of recentQueries()) expect(params?.mine).toBe(true);
  });

  it("does not query or resend mail when checking the current user fails", async () => {
    vi.mocked(authApi.me).mockRejectedValue(new Error("session expired"));
    render(<EmailLogsPage />);

    fireEvent.click(screen.getByRole("button", { name: "批次重新寄送近三天" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("批次重新寄送失敗"));
    expect(recentQueries()).toHaveLength(0);
    expect(emailApi.resendMessage).not.toHaveBeenCalled();
  });

  it("fetches later pages instead of limiting the batch to the first 200 messages", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => message(`system-${index}`, null));
    vi.mocked(emailApi.listMessages).mockImplementation(async (params) => {
      if (!params?.date_from || params.status !== "failed" || params.mine) return [];
      return params.offset === 0 ? firstPage : [OTHER_MESSAGE];
    });
    render(<EmailLogsPage />);

    fireEvent.click(screen.getByRole("button", { name: "批次重新寄送近三天" }));

    await waitFor(() => expect(emailApi.resendMessage).toHaveBeenCalledTimes(201));
    expect(emailApi.listMessages).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed", offset: 200, mine: false, date_from: CUTOFF,
    }));
    expect(emailApi.resendMessage).toHaveBeenCalledWith(OTHER_MESSAGE.id);
  });

  it("does not resend when the user cancels confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(emailApi.listMessages).mockImplementation(async (params) => (
      params?.date_from && params.status === "failed" ? [SYSTEM_MESSAGE] : []
    ));
    render(<EmailLogsPage />);

    fireEvent.click(screen.getByRole("button", { name: "批次重新寄送近三天" }));

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(emailApi.resendMessage).not.toHaveBeenCalled();
  });
});
