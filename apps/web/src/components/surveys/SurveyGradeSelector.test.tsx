import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SurveyGradeSelector from "./SurveyGradeSelector";

describe("SurveyGradeSelector", () => {
  it("selects multiple grades and allows a selected grade to be cleared", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SurveyGradeSelector value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "高一" }));
    expect(onChange).toHaveBeenLastCalledWith([1]);

    rerender(<SurveyGradeSelector value={[1]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "高二" }));
    expect(onChange).toHaveBeenLastCalledWith([1, 2]);

    rerender(<SurveyGradeSelector value={[1, 2]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "高一" }));
    expect(onChange).toHaveBeenLastCalledWith([2]);
  });
});
