import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { petitionsApi } from "@/lib/api";
import { PetitionConfidentialReasonEditor } from "./PetitionConfidentialReasonEditor";

describe("PetitionConfidentialReasonEditor", () => {
  afterEach(() => vi.restoreAllMocks());

  it("saves an edited reason and reports the updated value", async () => {
    const caseId = "petition-1";
    const setConfidential = vi.spyOn(petitionsApi, "setConfidential").mockResolvedValue({
      id: caseId,
      is_confidential: true,
      confidential_reason: "更新後的原因",
    });
    const onUpdated = vi.fn();

    render(
      <PetitionConfidentialReasonEditor
        caseId={caseId}
        reason="原本的原因"
        onUpdated={onUpdated}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "編輯原因" }));
    const input = screen.getByRole("textbox", { name: "密件原因" });
    expect(input).toHaveValue("原本的原因");
    fireEvent.change(input, { target: { value: "更新後的原因" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存密件原因" }));

    await waitFor(() => {
      expect(setConfidential).toHaveBeenCalledWith(caseId, "更新後的原因");
      expect(onUpdated).toHaveBeenCalledWith("更新後的原因");
      expect(screen.getByRole("button", { name: "編輯原因" })).toBeVisible();
    });
  });

  it("keeps the save action disabled when the reason is blank", () => {
    render(
      <PetitionConfidentialReasonEditor
        caseId="petition-1"
        reason="原本的原因"
        onUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "編輯原因" }));
    fireEvent.change(screen.getByRole("textbox", { name: "密件原因" }), {
      target: { value: "   " },
    });

    expect(screen.getByRole("button", { name: "儲存密件原因" })).toBeDisabled();
  });
});
