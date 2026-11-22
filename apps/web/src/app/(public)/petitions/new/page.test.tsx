import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NewPetitionPage from "./page";

const api = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return {
    ApiError,
    me: vi.fn(),
    listTypes: vi.fn(),
    submit: vi.fn(),
  };
});

vi.mock("@/lib/api", () => ({
  ApiError: api.ApiError,
  usersApi: { me: api.me },
  petitionsApi: {
    listTypes: api.listTypes,
    submit: api.submit,
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/ui/AnimatedFileUpload", () => ({
  default: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button
      type="button"
      onClick={() => onFiles([
        new File(["x"], "證據.pdf"),
        new File(["y"], "照片.pdf"),
      ])}
    >加入附件</button>
  ),
}));

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  api.me.mockResolvedValue({ id: "u1", display_name: "測試同學", email: "s@example.com" });
  api.listTypes.mockResolvedValue([{ id: "type-1", name: "校園環境" }]);
  api.submit.mockResolvedValue({
    id: "case-1",
    case_number: "P-0001",
    status_public_message: "已收件",
  });
});

async function fillAndSubmit() {
  render(<NewPetitionPage />);
  fireEvent.change(await screen.findByLabelText("標題"), { target: { value: "走廊燈壞了" } });
  fireEvent.change(screen.getByLabelText("陳情內容"), { target: { value: "三樓走廊燈不亮" } });
  fireEvent.click(screen.getByRole("button", { name: "加入附件" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "送出陳情" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "送出陳情" }));
}

describe("我要陳情", () => {
  it("submits the case and multiple attachments in one request", async () => {
    await fillAndSubmit();

    expect(await screen.findByText("P-0001")).toBeVisible();
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(api.submit).toHaveBeenCalledWith(
      { type_id: "type-1", title: "走廊燈壞了", content: "三樓走廊燈不亮" },
      expect.arrayContaining([
        expect.objectContaining({ name: "證據.pdf" }),
        expect.objectContaining({ name: "照片.pdf" }),
      ]),
    );
  });

  it("keeps the form when submission rejects an attachment", async () => {
    api.submit.mockRejectedValue(new api.ApiError(422, "附件格式不支援"));

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("附件格式不支援");
    expect(screen.getByLabelText("標題")).toHaveValue("走廊燈壞了");
    expect(screen.queryByText("P-0001")).not.toBeInTheDocument();
    expect(api.submit).toHaveBeenCalledTimes(1);
  });

  it("keeps the form and shows an inline error when submission fails", async () => {
    api.submit.mockRejectedValue(new api.ApiError(500, "伺服器暫時無法處理"));

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("伺服器暫時無法處理");
    expect(screen.getByLabelText("標題")).toHaveValue("走廊燈壞了");
    expect(screen.queryByText("P-0001")).not.toBeInTheDocument();
    expect(api.submit).toHaveBeenCalledTimes(1);
  });
});
