import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GuidedForm, { GuidedFormStep } from "./GuidedForm";

function Form() {
  const [active, setActive] = useState(0);
  return <GuidedForm steps={[
    { label: "基本資料", description: "填寫基本內容" },
    { label: "確認", description: "確認後儲存" },
  ]} activeStep={active} onStepChange={setActive} onBack={() => setActive(0)}
    onNext={() => setActive(1)} onSave={() => {}} saveLabel="儲存">
    <GuidedFormStep step={0} activeStep={active}>
      <label>基本欄位<input defaultValue="既有內容" /></label>
    </GuidedFormStep>
    <GuidedFormStep step={1} activeStep={active}><p>確認內容</p></GuidedFormStep>
  </GuidedForm>;
}

describe("guided form initial content", () => {
  it("keeps server-rendered fields free from an entrance fade", () => {
    expect(renderToString(<Form />)).toContain('data-animate="false"');
    render(<Form />);
    expect(screen.getByLabelText("基本欄位").closest("section")).toHaveAttribute("data-animate", "false");
  });

  it("animates step navigation, including a return to the first step, without losing input", () => {
    render(<Form />);
    fireEvent.change(screen.getByLabelText("基本欄位"), { target: { value: "更新內容" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByText("確認內容").closest("section")).toHaveAttribute("data-animate", "true");
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));
    expect(screen.getByLabelText("基本欄位")).toHaveValue("更新內容");
    expect(screen.getByLabelText("基本欄位").closest("section")).toHaveAttribute("data-animate", "true");
  });
});
