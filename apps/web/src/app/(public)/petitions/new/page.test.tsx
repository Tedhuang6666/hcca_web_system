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
    create: vi.fn(),
    uploadAttachment: vi.fn(),
  };
});

vi.mock("@/lib/api", () => ({
  ApiError: api.ApiError,
  usersApi: { me: api.me },
  petitionsApi: {
    listTypes: api.listTypes,
    create: api.create,
    uploadAttachment: api.uploadAttachment,
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/ui/AnimatedFileUpload", () => ({
  default: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button type="button" onClick={() => onFiles([new File(["x"], "證據.pdf")])}>加入附件</button>
  ),
}));

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  api.me.mockResolvedValue({ id: "u1", display_name: "測試同學", email: "s@example.com" });
  api.listTypes.mockResolvedValue([{ id: "type-1", name: "校園環境" }]);
  api.create.mockResolvedValue({
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
  it("shows the receipt once and lists attachments that failed to upload", async () => {
    api.uploadAttachment.mockRejectedValue(new Error("upload failed"));

    await fillAndSubmit();

    expect(await screen.findByText("P-0001")).toBeVisible();
    expect(await screen.findByText("上傳失敗")).toBeVisible();
    expect(screen.getByRole("button", { name: "重試上傳 證據.pdf" })).toBeVisible();
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("shows the case number while upload is pending and retries only the attachment", async () => {
    let rejectUpload!: (error: Error) => void;
    api.uploadAttachment.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectUpload = reject; }));
    api.uploadAttachment.mockResolvedValueOnce({});

    await fillAndSubmit();
    expect(await screen.findByText("P-0001")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("附件上傳中");
    rejectUpload(new Error("upload failed"));
    fireEvent.click(await screen.findByRole("button", { name: "重試上傳 證據.pdf" }));
    expect(await screen.findByText("已上傳")).toBeVisible();
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.uploadAttachment).toHaveBeenCalledTimes(2);
  });

  it("keeps the form and shows an inline error when the case cannot be created", async () => {
    api.create.mockRejectedValue(new api.ApiError(500, "伺服器暫時無法處理"));

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("伺服器暫時無法處理");
    expect(screen.getByLabelText("標題")).toHaveValue("走廊燈壞了");
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });
});
