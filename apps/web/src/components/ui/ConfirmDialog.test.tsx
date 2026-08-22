import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ConfirmProvider, useConfirm, usePrompt } from "./ConfirmDialog";

function ConfirmHarness() {
  const confirm = useConfirm();
  const [result, setResult] = useState<string>("");

  return (
    <>
      <button onClick={async () => setResult(String(await confirm({ title: "刪除資料", danger: true })))}>
        開啟確認
      </button>
      <output>{result}</output>
    </>
  );
}

function PromptHarness() {
  const prompt = usePrompt();
  const [result, setResult] = useState<string>("");

  return (
    <>
      <button onClick={async () => setResult((await prompt({
        title: "輸入退件原因",
        inputLabel: "退件原因",
        required: true,
      })) ?? "cancelled")}>
        開啟輸入
      </button>
      <output>{result}</output>
    </>
  );
}

describe("ConfirmProvider", () => {
  it("uses an accessible modal instead of the browser confirmation dialog", async () => {
    render(<ConfirmProvider><ConfirmHarness /></ConfirmProvider>);

    fireEvent.click(screen.getByRole("button", { name: "開啟確認" }));
    expect(await screen.findByRole("dialog", { name: "刪除資料" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(await screen.findByText("false")).toBeVisible();
  });

  it("collects required input before resolving a prompt", async () => {
    render(<ConfirmProvider><PromptHarness /></ConfirmProvider>);

    fireEvent.click(screen.getByRole("button", { name: "開啟輸入" }));
    const input = await screen.findByRole("textbox", { name: "退件原因" });
    const submit = screen.getByRole("button", { name: "確定" });
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: "缺少附件" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("缺少附件")).toBeVisible();
  });
});
