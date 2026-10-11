import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DelegationLinks from "./DelegationLinks";
import type { ShopDelegationOut } from "@/lib/types";

const api = vi.hoisted(() => ({ listDelegationLinks: vi.fn(), createDelegationLink: vi.fn(), renameDelegationLink: vi.fn(), revokeDelegationLink: vi.fn(), renewDelegationLink: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (error: Error) => error.message }));
const link: ShopDelegationOut = { id: "link", category_id: "goods", activity_id: "festival", name: "給媽媽代訂", created_at: "2026-10-10T00:00:00Z", revoked_at: null, bound_user_name: "媽媽", bound_user_email: "parent@synthetic.test" };
beforeEach(() => vi.resetAllMocks());

describe("學生代訂連結管理", () => {
  it("creates a named link and presents the fragment URL for sharing", async () => {
    api.listDelegationLinks.mockResolvedValue([]);
    api.createDelegationLink.mockResolvedValue({ ...link, token: "synthetic-test-token" });
    render(<DelegationLinks categoryId="goods" activityId="festival" />);
    fireEvent.click(screen.getByText("請家人幫忙代訂"));
    await screen.findByText("這個活動尚未建立代訂連結。");
    fireEvent.change(screen.getByRole("textbox", { name: "連結名稱（給誰代訂）" }), { target: { value: "給媽媽代訂" } });
    fireEvent.click(screen.getByRole("button", { name: "建立連結" }));
    await waitFor(() => expect(api.createDelegationLink).toHaveBeenCalledWith({ name: "給媽媽代訂", category_id: "goods" }));
    expect(await screen.findByRole("textbox", { name: "分享連結（請在離開頁面前保存）" })).toHaveValue(`${window.location.origin}/shop#delegate=synthetic-test-token`);
  });

  it("displays the bound account and supports renaming and revocation", async () => {
    api.listDelegationLinks.mockResolvedValue([link]);
    api.renameDelegationLink.mockResolvedValue({ ...link, name: "給家人代訂" });
    api.revokeDelegationLink.mockResolvedValue(undefined);
    render(<DelegationLinks categoryId="goods" activityId="festival" />);
    fireEvent.click(screen.getByText("請家人幫忙代訂"));
    expect(await screen.findByText("已綁定 媽媽（parent@synthetic.test）")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "修改給媽媽代訂的名稱" }), { target: { value: "給家人代訂" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存名稱" }));
    await waitFor(() => expect(api.renameDelegationLink).toHaveBeenCalledWith("link", "給家人代訂"));
    await waitFor(() => expect(screen.getByRole("button", { name: "撤銷" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "撤銷" }));
    await waitFor(() => expect(api.revokeDelegationLink).toHaveBeenCalledWith("link"));
    expect(await screen.findByRole("status")).toHaveTextContent("已登記的品項仍保留");
  });

  it("shows a retry action for failed loading", async () => {
    api.listDelegationLinks.mockRejectedValue(new Error("讀取失敗"));
    render(<DelegationLinks categoryId="goods" activityId={null} />);
    fireEvent.click(screen.getByText("請家人幫忙代訂"));
    expect(await screen.findByRole("status")).toHaveTextContent("讀取失敗");
    expect(screen.getByRole("button", { name: "重新載入連結" })).toBeVisible();
  });

  it("keeps a newly generated share URL when the student renames it", async () => {
    api.listDelegationLinks.mockResolvedValueOnce([]).mockResolvedValue([link]);
    api.createDelegationLink.mockResolvedValue({ ...link, token: "synthetic-test-token" });
    api.renameDelegationLink.mockResolvedValue({ ...link, name: "給家人代訂" });
    render(<DelegationLinks categoryId="goods" activityId="festival" />);
    fireEvent.click(screen.getByText("請家人幫忙代訂"));
    await screen.findByText("這個活動尚未建立代訂連結。");
    fireEvent.change(screen.getByRole("textbox", { name: "連結名稱（給誰代訂）" }), { target: { value: "給媽媽代訂" } });
    fireEvent.click(screen.getByRole("button", { name: "建立連結" }));
    await screen.findByRole("textbox", { name: "分享連結（請在離開頁面前保存）" });
    await screen.findByRole("textbox", { name: "修改給媽媽代訂的名稱" });
    await waitFor(() => expect(screen.getByRole("button", { name: "儲存名稱" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "修改給媽媽代訂的名稱" }), { target: { value: "給家人代訂" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存名稱" }));
    await waitFor(() => expect(api.renameDelegationLink).toHaveBeenCalledWith("link", "給家人代訂"));
    expect(screen.getByRole("textbox", { name: "分享連結（請在離開頁面前保存）" })).toHaveValue(`${window.location.origin}/shop#delegate=synthetic-test-token`);
  });

  it("allows revoking old activity links so they do not trap the active link limit", async () => {
    const oldLink = { ...link, id: "old-link", activity_id: "old-festival", name: "上一場活動" };
    api.listDelegationLinks.mockResolvedValue([oldLink]);
    api.revokeDelegationLink.mockResolvedValue(undefined);
    render(<DelegationLinks categoryId="goods" activityId="festival" />);
    fireEvent.click(screen.getByText("請家人幫忙代訂"));
    fireEvent.click(await screen.findByText("其他活動的連結（1）"));
    expect(screen.getByRole("textbox", { name: "修改上一場活動的名稱" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "撤銷" }));
    await waitFor(() => expect(api.revokeDelegationLink).toHaveBeenCalledWith("old-link"));
  });
});
