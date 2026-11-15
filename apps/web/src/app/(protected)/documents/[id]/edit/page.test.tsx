import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentOut } from "@/lib/types";
import EditDocumentPage from "./page";

const state = vi.hoisted(() => ({
  get: vi.fn(), update: vi.fn(), recipients: vi.fn(), push: vi.fn(),
  onlineSave: null as null | (() => Promise<void>),
  clearDraft: vi.fn(), flushDraft: vi.fn(),
}));
const router = { push: state.push };
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "舊字第1150000001號" }), useRouter: () => router }));
vi.mock("@/lib/api", () => ({
  documentsApi: { get: state.get, update: state.update },
  documentsRecipientsApi: { update: state.recipients },
  serialTemplatesApi: { list: vi.fn().mockResolvedValue([]) },
  apiErrorMessage: () => "儲存失敗",
}));
vi.mock("@/hooks/useDraftAutosave", () => ({ useDraftAutosave: () => ({ clearDraft: state.clearDraft, flushDraft: state.flushDraft, lastSavedAt: null }) }));
vi.mock("@/hooks/useOnlineAutosave", () => ({ useOnlineAutosave: (options: { save: () => Promise<void> }) => {
  state.onlineSave = options.save;
  return { status: "idle", lastSavedAt: null, error: null };
} }));
vi.mock("@/components/ui/GongwenEditor", () => ({ default: () => null }));
vi.mock("@/components/ui/SmartTextarea", () => ({ default: () => null }));
vi.mock("@/components/ui/AnimatedFileUpload", () => ({ default: () => null }));
vi.mock("@/components/documents/OrganizationEmailRecipientSettings", () => ({ OrganizationEmailRecipientSettings: () => null }));
vi.mock("@/components/documents/AttachmentNameEditor", () => ({ AttachmentNameEditor: () => null }));

const document: DocumentOut = {
  id: "stable-document-uuid", serial_number: "舊字第1150000001號", title: "修改字號驗收",
  urgency: "normal", classification: "normal", category: "decree", subject: null, summary: "既有摘要",
  content: "原始正文", doc_description: "原始正文", action_required: null,
  handler_name: null, handler_unit: null, handler_email: null, status: "draft", current_step: 0,
  org_id: "org-1", created_by: "user-1", declassification_condition: "none",
  is_public: false, visibility_level: "org_only", issued_at: null, due_date: null, submitted_at: null,
  completed_at: null, created_at: "2026-11-14T00:00:00Z", updated_at: "2026-11-14T00:00:00Z",
  revisions: [], approvals: [], attachments: [], recipients: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.get.mockResolvedValue(document);
  state.update.mockResolvedValue({ ...document, serial_number: "新字第1150000002號" });
  state.recipients.mockResolvedValue([]);
});

describe("更改公文字號後儲存", () => {
  it("由舊字號進入後，自動儲存與手動儲存都使用不變的 UUID", async () => {
    render(<EditDocumentPage />);
    fireEvent.change(await screen.findByDisplayValue(document.serial_number), { target: { value: "新字第1150000002號" } });
    await act(async () => { await state.onlineSave?.(); });
    expect(state.update).toHaveBeenLastCalledWith(document.id, expect.objectContaining({ serial_number: "新字第1150000002號", autosave: true, summary: "既有摘要" }));
    expect(state.recipients).toHaveBeenLastCalledWith(document.id, []);
    fireEvent.click(screen.getByRole("button", { name: "儲存變更" }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith(`/documents/${document.id}`));
    expect(state.update).toHaveBeenLastCalledWith(document.id, expect.objectContaining({ autosave: false }));
    expect(state.get).toHaveBeenCalledTimes(1);
  });
});
