import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-helpers";
import { AttachmentNameEditor } from "./AttachmentNameEditor";

describe("附件重新命名", () => {
  it("可用鍵盤儲存名稱並保留副檔名的輸入選擇", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AttachmentNameEditor name="upload.pdf" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "重新命名 upload.pdf" }));
    const input = screen.getByLabelText("附件名稱");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "  議程附件  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("議程附件"));
    await waitFor(() => expect(screen.queryByLabelText("附件名稱")).not.toBeInTheDocument());
  });

  it("空白名稱會顯示欄位錯誤，取消不會送出變更", () => {
    const onSave = vi.fn();
    render(<AttachmentNameEditor name="upload.pdf" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "重新命名 upload.pdf" }));
    fireEvent.change(screen.getByLabelText("附件名稱"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "儲存名稱" }));
    expect(screen.getByRole("alert")).toHaveTextContent("附件名稱不可為空");
    expect(screen.getByLabelText("附件名稱")).toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(screen.getByLabelText("附件名稱"), { key: "Escape" });
    expect(screen.queryByLabelText("附件名稱")).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("儲存期間停用操作，失敗後保留輸入以便重試", async () => {
    let rejectSave: (reason: Error) => void = () => {};
    const onSave = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    render(<AttachmentNameEditor name="upload.pdf" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "重新命名 upload.pdf" }));
    fireEvent.change(screen.getByLabelText("附件名稱"), { target: { value: "新名稱.pdf" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存名稱" }));
    expect(screen.getByRole("button", { name: "儲存中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    rejectSave(new ApiError(403, "目前無法修改此公文"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("目前無法修改此公文"));
    expect(screen.getByLabelText("附件名稱")).toHaveValue("新名稱.pdf");
    expect(screen.getByRole("button", { name: "儲存名稱" })).toBeEnabled();
  });
});
