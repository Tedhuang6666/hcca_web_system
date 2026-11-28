import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import AgencyLink from "./AgencyLink";

const DOC = "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrSt/edit";

describe("AgencyLink", () => {
  it("expands a Google Docs preview from the keyboard and collapses it again", async () => {
    const user = userEvent.setup();
    render(<AgencyLink href={DOC} title="第 3 次常會紀錄" />);

    expect(screen.getByRole("link", { name: "在 Google 雲端開啟" })).toHaveAttribute("target", "_blank");
    const toggle = screen.getByRole("button", { name: "展開預覽" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTitle("第 3 次常會紀錄（預覽）")).toBeNull();

    toggle.focus();
    await user.keyboard("{Enter}");
    const frame = screen.getByTitle("第 3 次常會紀錄（預覽）");
    expect(frame).toHaveAttribute("src", "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrSt/preview");
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(screen.getByRole("button", { name: "收合預覽" })).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "收合預覽" }));
    expect(screen.queryByTitle("第 3 次常會紀錄（預覽）")).toBeNull();
  });

  it("only offers a plain link for non-Google files", () => {
    render(<AgencyLink href="/uploads/report.pdf" title="報告" />);
    expect(screen.getByRole("link", { name: "開啟文件" })).not.toHaveAttribute("target");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
