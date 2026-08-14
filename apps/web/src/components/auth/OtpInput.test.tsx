import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import OtpInput from "./OtpInput";

function NumericHarness({ onComplete = vi.fn() }: { onComplete?: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <OtpInput value={value} onChange={setValue} onComplete={onComplete} />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("OtpInput", () => {
  it("fills all slots when a complete numeric code is pasted", () => {
    const onComplete = vi.fn();
    render(<NumericHarness onComplete={onComplete} />);
    const firstInput = screen.getAllByRole("textbox")[0];

    fireEvent.paste(firstInput, {
      clipboardData: { getData: () => "12a3456" },
    });

    expect(screen.getByTestId("value")).toHaveTextContent("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("ignores non-hex characters in backup codes", () => {
    function BackupHarness() {
      const [value, setValue] = useState("");
      return (
        <>
          <OtpInput mode="backup" value={value} onChange={setValue} />
          <output data-testid="backup-value">{value}</output>
        </>
      );
    }

    render(<BackupHarness />);
    fireEvent.paste(screen.getAllByRole("textbox")[0], {
      clipboardData: { getData: () => "ab12-zz34" },
    });

    expect(screen.getByTestId("backup-value")).toHaveTextContent("AB1234");
  });

  it("removes the focused slot with Backspace", () => {
    render(<NumericHarness />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "1" } });
    fireEvent.change(inputs[1], { target: { value: "2" } });
    fireEvent.keyDown(inputs[1], { key: "Backspace" });

    expect(screen.getByTestId("value")).toHaveTextContent("1");
  });
});
