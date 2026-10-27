import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMergeSection } from "./AccountMergeSection";
import { adminApi, ApiError } from "@/lib/api";
import type { AccountMergeConflict } from "@/lib/types";

vi.mock("@/lib/api", async () => {
  const helpers = await vi.importActual<typeof import("@/lib/api-helpers")>("@/lib/api-helpers");
  return { ...helpers, adminApi: { previewUserMerge: vi.fn(), mergeUserAccounts: vi.fn(), listUsers: vi.fn() } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const primary = { id: "primary-uuid", display_name: "主要姓名", email: "primary@example.test", student_id: "115001", linked_emails: [], is_active: true };
const source = { ...primary, id: "source-uuid", display_name: "次要姓名", email: "secondary@example.test", student_id: "115002", linked_emails: ["alias@example.test"] };
const conflict: AccountMergeConflict = {
  key: "records:discord:opaque-internal-id", category: "record", resolvable: true,
  title: "Discord 綁定", message: "請選擇要保留的綁定。",
  records: [
    { id: "target-record", side: "target", owner_user_id: primary.id, owner_name: primary.display_name, label: "使用者名稱：primary-discord", fields: {} },
    { id: "source-record", side: "source", owner_user_id: source.id, owner_name: source.display_name, label: "使用者名稱：secondary-discord", fields: {} },
  ],
};

function setup() {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(<AccountMergeSection user={primary} users={[primary, source]} onChanged={onChanged} />);
  return { onChanged, user: userEvent.setup() };
}
async function selectSource(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "次要帳戶（可選多個）" }));
  await user.type(screen.getByRole("combobox", { name: "次要帳戶（可選多個）" }), "alias@example.test");
  fireEvent.mouseDown(screen.getByRole("button", { name: /次要姓名 · 115002/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminApi.listUsers).mockResolvedValue([]);
  vi.mocked(adminApi.previewUserMerge).mockResolvedValue({ conflicts: [] });
  vi.mocked(adminApi.mergeUserAccounts).mockResolvedValue({} as Awaited<ReturnType<typeof adminApi.mergeUserAccounts>>);
});

describe("帳戶合併", () => {
  it("可用別名搜尋、多選並移除，主要帳戶不會列入次要候選", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("combobox", { name: "次要帳戶（可選多個）" }));
    expect(screen.queryByRole("option", { name: /主要姓名/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: "次要帳戶（可選多個）" }), "無此帳戶");
    expect(screen.getByText("找不到其他帳戶，請換個關鍵字搜尋")).toBeInTheDocument();
    await user.clear(screen.getByRole("combobox", { name: "次要帳戶（可選多個）" }));
    await selectSource(user);
    expect(screen.getByRole("button", { name: "檢查衝突並合併（1）" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /移除 次要姓名/ }));
    expect(screen.getByRole("button", { name: "檢查衝突並合併" })).toBeDisabled();
  });

  it("能搜尋初始清單以外的帳戶，使用鍵盤選取並移除", async () => {
    const remote = { ...source, id: "remote-uuid", display_name: "遠端帳戶", email: "remote@example.test" };
    vi.mocked(adminApi.listUsers).mockResolvedValue([remote] as Awaited<ReturnType<typeof adminApi.listUsers>>);
    const { user } = setup();
    await user.click(screen.getByRole("combobox", { name: "次要帳戶（可選多個）" }));
    await user.type(screen.getByRole("combobox", { name: "次要帳戶（可選多個）" }), "遠端帳戶");
    await screen.findByRole("option", { name: /遠端帳戶/ });
    expect(adminApi.listUsers).toHaveBeenCalledWith({ keyword: "遠端帳戶", active_only: true, limit: 200 });
    await user.keyboard("{Enter}");
    const remove = screen.getByRole("button", { name: /移除 遠端帳戶/ });
    remove.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "檢查衝突並合併" })).toBeDisabled();
  });

  it("真正衝突要求逐項選擇，確認後提交所選來源，內部 ID 不顯示", async () => {
    vi.mocked(adminApi.previewUserMerge).mockResolvedValue({ conflicts: [conflict] });
    const { user, onChanged } = setup();
    await selectSource(user);
    await user.click(screen.getByRole("button", { name: "檢查衝突並合併（1）" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "確認選擇並繼續" })).toBeDisabled();
    expect(dialog).not.toHaveTextContent("uuid");
    expect(dialog).not.toHaveTextContent("opaque-internal-id");
    await user.click(within(dialog).getByRole("radio", { name: /secondary-discord/ }));
    await user.click(within(dialog).getByRole("button", { name: "確認選擇並繼續" }));
    expect(screen.getByText(/Discord 綁定：次要姓名/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確認合併帳戶" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(adminApi.mergeUserAccounts).toHaveBeenCalledWith(primary.id, [source.id], { [conflict.key]: "source-record" });
  });

  it("提交時才出現的 409 會重新取得預覽並開啟選擇視窗", async () => {
    vi.mocked(adminApi.previewUserMerge).mockResolvedValueOnce({ conflicts: [] }).mockResolvedValueOnce({ conflicts: [conflict] });
    vi.mocked(adminApi.mergeUserAccounts).mockRejectedValueOnce(new ApiError(409, "新增資料衝突"));
    const { user } = setup();
    await selectSource(user);
    await user.click(screen.getByRole("button", { name: "檢查衝突並合併（1）" }));
    await user.click(await screen.findByRole("button", { name: "確認合併帳戶" }));
    expect(await screen.findByRole("heading", { name: "選擇要保留的資料" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("合併資料已變更");
    expect(adminApi.previewUserMerge).toHaveBeenCalledTimes(2);
  });

  it("檢查失敗保留選擇可重試，合併中禁止重複送出", async () => {
    vi.mocked(adminApi.previewUserMerge).mockRejectedValueOnce(new ApiError(503, "暫時無法檢查"));
    const { user } = setup();
    await selectSource(user);
    await user.click(screen.getByRole("button", { name: "檢查衝突並合併（1）" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暫時無法檢查");
    await user.click(screen.getByRole("button", { name: "檢查衝突並合併（1）" }));
    let finish: (value: Awaited<ReturnType<typeof adminApi.mergeUserAccounts>>) => void = () => {};
    vi.mocked(adminApi.mergeUserAccounts).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await user.click(await screen.findByRole("button", { name: "確認合併帳戶" }));
    expect(screen.getByRole("button", { name: "合併中…" })).toBeDisabled();
    expect(adminApi.mergeUserAccounts).toHaveBeenCalledOnce();
    await act(async () => finish({} as Awaited<ReturnType<typeof adminApi.mergeUserAccounts>>));
  });
});
