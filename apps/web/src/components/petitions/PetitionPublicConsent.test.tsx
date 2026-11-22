import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { petitionsApi } from "@/lib/api/petitions";
import type { PetitionCaseOut } from "@/lib/types";
import PetitionPublicConsent from "./PetitionPublicConsent";

const item = {
  id: "petition-1",
  title: "原始標題",
  content: "原始內容",
  public_title: "公開標題草案",
  public_content: "公開內容草案",
  public_status: "pending_user",
} as PetitionCaseOut;

describe("PetitionPublicConsent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the draft diff first and approves it without edits", async () => {
    const respond = vi.spyOn(petitionsApi, "respondPublic").mockResolvedValue(item);
    render(<PetitionPublicConsent item={item} onUpdated={vi.fn()} />);

    expect(screen.queryByLabelText("公開內容")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "同意公開" }));

    await waitFor(() => expect(respond).toHaveBeenCalledWith("petition-1", { decision: "approve" }));
  });

  it("sends edited text only from the edit step", async () => {
    const respond = vi.spyOn(petitionsApi, "respondPublic").mockResolvedValue(item);
    render(<PetitionPublicConsent item={item} onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "修改內容" }));
    const submit = screen.getByRole("button", { name: "送出修改並同意" });
    expect(submit).toBeDisabled();
    expect(screen.queryByRole("button", { name: "同意公開" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("公開內容"), { target: { value: "修改後內容" } });
    fireEvent.click(submit);

    await waitFor(() => expect(respond).toHaveBeenCalledWith("petition-1", {
      decision: "approve_with_changes",
      title: "公開標題草案",
      content: "修改後內容",
    }));
  });

  it("discards edits when cancelling", () => {
    render(<PetitionPublicConsent item={item} onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "修改內容" }));
    fireEvent.change(screen.getByLabelText("公開內容"), { target: { value: "暫時修改" } });
    fireEvent.click(screen.getByRole("button", { name: "取消修改" }));
    fireEvent.click(screen.getByRole("button", { name: "修改內容" }));

    expect(screen.getByLabelText("公開內容")).toHaveValue("公開內容草案");
  });
});
