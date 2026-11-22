import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ParentDelegationEntry from "./ParentDelegationEntry";

const exchange = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  shopApi: { exchangeDelegationCode: exchange },
  apiErrorMessage: (error: Error) => error.message,
}));
beforeEach(() => {
  exchange.mockReset();
  window.history.replaceState({}, "", "/shop");
});

describe("家長授權入口", () => {
  it("asks guests to log into their own account and provides both methods in the guide", () => {
    render(<ParentDelegationEntry isLoggedIn={false} />);
    expect(screen.getByRole("link", { name: "登入後開始代訂" })).toHaveAttribute("href", "/login?next=%2Fshop%3Fdelegation%3Dentry");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "還沒有驗證碼？請孩子這樣設定" })).toBeVisible();
    expect(screen.getByText("用學生帳號登入，打開商品頁，點「家人代訂」。")).toBeVisible();
    expect(screen.getByText(/選擇活動與家長稱呼/)).toBeVisible();
    expect(screen.getByText(/將驗證碼或分享連結傳給家長/)).toBeVisible();
    expect(screen.getByText(/授權有效至商品截止或班級結單/)).toBeVisible();
    fireEvent.click(screen.getByText("完整操作介紹與權限說明"));
    expect(screen.getByText(/輸入驗證碼或開啟分享連結/)).toBeVisible();
    expect(screen.getByText(/請勿分享帳密/)).toBeVisible();
  });

  it("normalizes pasted full-width digits and spaces without losing the leading zero", async () => {
    exchange.mockResolvedValue({ token: "synthetic-link-token" });
    render(<ParentDelegationEntry isLoggedIn />);
    const input = screen.getByRole("textbox", { name: "學生提供的七位數代訂驗證碼" });
    const button = screen.getByRole("button", { name: "查看學生授權" });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: "０１２ ３４５６" } });
    expect(input).toHaveValue("0123456");
    fireEvent.click(button);
    await waitFor(() => expect(exchange).toHaveBeenCalledWith("0123456"));
    await waitFor(() => expect(window.location.hash).toBe("#delegate=synthetic-link-token"));
  });

  it("prevents repeated submissions and allows correcting the code after an error", async () => {
    let reject!: (error: Error) => void;
    exchange.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(<ParentDelegationEntry isLoggedIn />);
    const input = screen.getByRole("textbox", { name: "學生提供的七位數代訂驗證碼" });
    fireEvent.change(input, { target: { value: "0123456" } });
    fireEvent.click(screen.getByRole("button", { name: "查看學生授權" }));
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "確認授權碼中…" })).toBeDisabled();
    await act(async () => reject(new Error("授權碼無效或已過期")));
    expect(screen.getByRole("alert")).toHaveTextContent("授權碼無效或已過期");
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "7654321" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看學生授權" })).toBeEnabled();
  });
});
