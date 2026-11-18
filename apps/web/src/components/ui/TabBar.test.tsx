import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TabBar from "./TabBar";

type Key = "members" | "roles" | "roster";

function Harness({ onChange }: { onChange?: (key: Key) => void }) {
  const [value, setValue] = useState<Key>("members");
  return (
    <TabBar<Key>
      label="班級管理分頁"
      items={[
        { key: "members", label: "班級成員" },
        { key: "roles", label: "班代與幹部", meta: <span>3</span> },
        { key: "roster", label: "匯入與座號" },
      ]}
      value={value}
      onChange={(key) => {
        onChange?.(key);
        setValue(key);
      }}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
});

describe("TabBar", () => {
  it("exposes one selected tab and moves the location mark with the selection", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist", { name: "班級管理分頁" });
    expect(list).toBeVisible();
    const members = screen.getByRole("tab", { name: "班級成員" });
    expect(members).toHaveAttribute("aria-selected", "true");
    expect(members).toHaveAttribute("tabindex", "0");
    expect(members.querySelector(".module-tab-mark")).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /班代與幹部/ }));
    const roles = screen.getByRole("tab", { name: /班代與幹部/ });
    expect(roles).toHaveAttribute("aria-selected", "true");
    expect(roles.querySelector(".module-tab-mark")).not.toBeNull();
    expect(members.querySelector(".module-tab-mark")).toBeNull();
    expect(members).toHaveAttribute("tabindex", "-1");
  });

  it("switches with arrow keys, Home and End and keeps focus on the selected tab", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const members = screen.getByRole("tab", { name: "班級成員" });
    members.focus();

    fireEvent.keyDown(members, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("roster");
    expect(screen.getByRole("tab", { name: "匯入與座號" })).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("members");

    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("roster");

    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("members");
    expect(screen.getByRole("tab", { name: "班級成員" })).toHaveFocus();

    onChange.mockClear();
    fireEvent.keyDown(document.activeElement!, { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
