import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SurveyMarkdownField } from "./SurveyMarkdownField";

function Editor() {
  const [value, setValue] = useState("初始內容");
  return <SurveyMarkdownField label="問卷說明" value={value} onChange={setValue} />;
}

describe("survey Markdown preview", () => {
  it("previews the latest draft and keeps it editable after switching back", async () => {
    render(<Editor />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "**更新內容**" } });
    fireEvent.click(screen.getByRole("button", { name: "預覽" }));
    expect(await screen.findByText("更新內容")).toHaveProperty("tagName", "STRONG");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    expect(screen.getByRole("textbox", { name: "問卷說明" })).toHaveValue("**更新內容**");
  });

  it("explains an empty preview and allows typing again", () => {
    render(<Editor />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "預覽" }));
    expect(screen.getByText("目前沒有內容。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
