import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalPanel } from "./ApprovalPanel";

describe("公文審核錯誤", () => {
  it.each(["核准", "退件"])("%s 失敗時保留操作並顯示錯誤", async (action) => {
    render(<ApprovalPanel steps={[]} canApprove currentUserId="user" allUsers={[]}
      onLoadUsers={vi.fn()} onApprove={vi.fn().mockRejectedValue(new Error("failed"))}
      onReject={vi.fn().mockRejectedValue(new Error("failed"))} onSetDelegate={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: action }));
    if (action === "退件") {
      fireEvent.change(screen.getByLabelText("退件原因"), { target: { value: "需要補件" } });
      fireEvent.click(screen.getByRole("button", { name: "確認退件" }));
    }
    expect(await screen.findByRole("alert")).toHaveTextContent(`${action}失敗`);
    if (action === "退件") expect(screen.getByLabelText("退件原因")).toHaveValue("需要補件");
  });
});
