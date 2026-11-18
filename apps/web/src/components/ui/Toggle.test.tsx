import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Toggle from "./Toggle";

describe("Toggle", () => {
  it("reports the next state and keeps a stable name while switching", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Toggle checked={false} onChange={onChange} ariaLabel="減少背景流量" />);
    const control = screen.getByRole("switch", { name: "減少背景流量" });
    expect(control).toHaveAttribute("aria-checked", "false");

    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(<Toggle checked onChange={onChange} ariaLabel="減少背景流量" />);
    expect(screen.getByRole("switch", { name: "減少背景流量" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("can be operated from its visible label", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="首頁精選" />);
    fireEvent.click(screen.getByText("首頁精選"));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("switch", { name: "首頁精選" })).toBeVisible();
  });

  it("ignores presses while disabled", () => {
    const onChange = vi.fn();
    render(<Toggle checked onChange={onChange} disabled ariaLabel="站內通知" />);
    fireEvent.click(screen.getByRole("switch", { name: "站內通知" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
