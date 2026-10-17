import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DelegationLinks from "./DelegationLinks";
import type { ShopDelegationOut } from "@/lib/types";

const api = vi.hoisted(() => ({ listDelegationLinks: vi.fn(), createDelegationLink: vi.fn(), renameDelegationLink: vi.fn(), revokeDelegationLink: vi.fn(), renewDelegationLink: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (error: Error) => error.message }));
const link: ShopDelegationOut = { id: "link", category_id: "goods", activity_id: "festival", name: "給媽媽代訂", created_at: "2026-10-10T00:00:00Z", revoked_at: null, bound_user_name: "媽媽", bound_user_email: "parent@synthetic.test" };
beforeEach(() => vi.resetAllMocks());

describe("學生代訂連結管理", () => {
  it("exposes the scoped entry without opening a disclosure and focuses the create form", async () => {
    api.listDelegationLinks.mockResolvedValue([]);
    render(<DelegationLinks categoryId="goods" activityId="festival" scopeName="校慶" />);
    const create = screen.getByRole("button", { name: "建立家長代訂連結" });
    expect(create).toBeVisible();
    expect(create).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("本次授權：校慶")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "邀請誰來代訂" })).not.toBeInTheDocument();
    fireEvent.click(create);
    expect(screen.getByRole("textbox", { name: "邀請誰來代訂" })).toHaveFocus();
    fireEvent.click(screen.getByText("完整操作介紹與權限說明"));
    expect(screen.getByText(/撤銷只停止後續代訂，已登記的品項仍保留/)).toBeVisible();
    await screen.findByText("這個活動尚未建立代訂連結。");
  });

  it("distinguishes pending loading from an activity without links", async () => {
    let finish!: (links: ShopDelegationOut[]) => void;
    api.listDelegationLinks.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<DelegationLinks categoryId="goods" activityId={null} scopeName="校慶商品" />);
    expect(screen.getByRole("status")).toHaveTextContent("載入代訂連結中");
    expect(screen.queryByText("這個活動尚未建立代訂連結。")).not.toBeInTheDocument();
    finish([]);
    await screen.findByText("這個活動尚未建立代訂連結。");
  });

  it("creates a named link and presents the fragment URL for sharing", async () => {
    api.listDelegationLinks.mockResolvedValue([]);
    api.createDelegationLink.mockResolvedValue({ ...link, token: "synthetic-test-token", authorization_code: "0123456", authorization_code_expires_at: "2026-10-14T01:30:00Z" });
    render(<DelegationLinks categoryId="goods" activityId="festival" scopeName="校慶" />);
    fireEvent.click(screen.getByRole("button", { name: "建立家長代訂連結" }));
    await screen.findByText("這個活動尚未建立代訂連結。");
    fireEvent.change(screen.getByRole("textbox", { name: "邀請誰來代訂" }), { target: { value: "給媽媽代訂" } });
    fireEvent.click(screen.getByRole("button", { name: "建立代訂驗證碼" }));
    await waitFor(() => expect(api.createDelegationLink).toHaveBeenCalledWith({ name: "給媽媽代訂", category_id: "goods" }));
    await screen.findByRole("textbox", { name: "七位數代訂驗證碼" });
    expect(await screen.findByRole("textbox", { name: "分享連結（請在離開頁面前保存）" })).toHaveValue(`${window.location.origin}/shop#delegate=synthetic-test-token`);
    expect(screen.getByRole("textbox", { name: "七位數代訂驗證碼" })).toHaveFocus();
    expect(screen.queryByRole("textbox", { name: "邀請誰來代訂" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "七位數代訂驗證碼" })).toHaveValue("0123456");
    expect(screen.getByRole("button", { name: "複製驗證碼" })).toBeVisible();
  });

  it("displays the bound account and supports renaming and revocation", async () => {
    api.listDelegationLinks.mockResolvedValue([link]);
    api.renameDelegationLink.mockResolvedValue({ ...link, name: "給家人代訂" });
    api.revokeDelegationLink.mockResolvedValue(undefined);
    render(<DelegationLinks categoryId="goods" activityId="festival" scopeName="校慶" />);
    fireEvent.click(screen.getByRole("button", { name: "建立家長代訂連結" }));
    fireEvent.click(await screen.findByText("管理本次授權的連結（1）"));
    expect(screen.getByText("已綁定 媽媽（parent@synthetic.test）")).toBeVisible();
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
    render(<DelegationLinks categoryId="goods" activityId={null} scopeName="校慶商品" />);
    fireEvent.click(screen.getByRole("button", { name: "建立家長代訂連結" }));
    expect(await screen.findByRole("status")).toHaveTextContent("讀取失敗");
    expect(screen.getByRole("button", { name: "重新載入連結" })).toBeVisible();
  });

  it("keeps a newly generated share URL when the student renames it", async () => {
    api.listDelegationLinks.mockResolvedValueOnce([]).mockResolvedValue([link]);
    api.createDelegationLink.mockResolvedValue({ ...link, token: "synthetic-test-token" });
    api.renameDelegationLink.mockResolvedValue({ ...link, name: "給家人代訂" });
    render(<DelegationLinks categoryId="goods" activityId="festival" scopeName="校慶" />);
    fireEvent.click(screen.getByRole("button", { name: "建立家長代訂連結" }));
    await screen.findByText("這個活動尚未建立代訂連結。");
    fireEvent.change(screen.getByRole("textbox", { name: "邀請誰來代訂" }), { target: { value: "給媽媽代訂" } });
    fireEvent.click(screen.getByRole("button", { name: "建立代訂驗證碼" }));
    await screen.findByRole("textbox", { name: "分享連結（請在離開頁面前保存）" });
    fireEvent.click(await screen.findByText("管理本次授權的連結（1）"));
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
    render(<DelegationLinks categoryId="goods" activityId="festival" scopeName="校慶" />);
    fireEvent.click(screen.getByRole("button", { name: "建立家長代訂連結" }));
    fireEvent.click(await screen.findByText("其他活動的連結（1）"));
    expect(screen.getByRole("textbox", { name: "修改上一場活動的名稱" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "撤銷" }));
    await waitFor(() => expect(api.revokeDelegationLink).toHaveBeenCalledWith("old-link"));
  });
});
