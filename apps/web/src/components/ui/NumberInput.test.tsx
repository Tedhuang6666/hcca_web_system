import { createRef, useState, type ComponentPropsWithRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import NumberInput from "./NumberInput";

function NumericField({ initial = 1, ...props }: ComponentPropsWithRef<"input"> & {
  initial?: number;
}) {
  const [value, setValue] = useState(initial);
  return <>
    <NumberInput aria-label="數量" {...props} value={value}
      onChange={(event) => setValue(Number(event.target.value))} />
    <output aria-label="目前數值">{value}</output>
  </>;
}

describe("NumberInput", () => {
  it("allows deleting 1 before typing 8 without adding a leading digit", async () => {
    const user = userEvent.setup();
    render(<NumericField min={1} max={100} />);
    const input = screen.getByRole("spinbutton", { name: "數量" });

    await user.clear(input);
    expect(input).toHaveValue(null);
    expect(screen.getByLabelText("目前數值")).toHaveTextContent("1");
    await user.type(input, "8");
    expect(input).toHaveValue(8);
    expect(screen.getByLabelText("目前數值")).toHaveTextContent("8");
  });

  it("restores the last number when an empty edit loses focus", async () => {
    const user = userEvent.setup();
    const onBlur = vi.fn();
    render(<NumericField initial={8} onBlur={(event) => onBlur(event.currentTarget.value)} />);
    const input = screen.getByRole("spinbutton");

    await user.clear(input);
    await user.tab();
    expect(input).toHaveValue(8);
    expect(onBlur).toHaveBeenCalledWith("8");
  });

  it("keeps zero editable and retains native number constraints", async () => {
    const user = userEvent.setup();
    render(<NumericField min={0} max={100} required />);
    const input = screen.getByRole("spinbutton");

    await user.clear(input);
    expect(input).toBeInvalid();
    await user.type(input, "0");
    expect(input).toHaveValue(0);
    expect(input).toBeValid();
    await user.clear(input);
    await user.type(input, "101");
    expect(input).toBeInvalid();
  });

  it("allows decimal and negative values after clearing", async () => {
    const user = userEvent.setup();
    render(<NumericField initial={10} step="0.01" />);
    const input = screen.getByRole("spinbutton");

    await user.clear(input);
    await user.type(input, "2.75");
    expect(input).toHaveValue(2.75);
    fireEvent.change(input, { target: { value: "-2.75" } });
    expect(input).toHaveValue(-2.75);
  });

  it("discards an empty draft when the parent replaces the value", () => {
    const { rerender } = render(<NumberInput value={1} onChange={() => {}} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue(null);

    rerender(<NumberInput value={5} onChange={() => {}} />);
    expect(input).toHaveValue(5);
    rerender(<NumberInput value={1} onChange={() => {}} />);
    expect(input).toHaveValue(1);
  });

  it("preserves string-based optional fields and forwards the input ref", async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    function OptionalField() {
      const [value, setValue] = useState("12");
      return <NumberInput ref={ref} value={value}
        onChange={(event) => setValue(event.target.value)} placeholder="不限制" />;
    }
    render(<OptionalField />);
    const input = screen.getByRole("spinbutton");
    expect(ref.current).toBe(input);

    await user.clear(input);
    await user.tab();
    expect(input).toHaveValue(null);
  });
});
