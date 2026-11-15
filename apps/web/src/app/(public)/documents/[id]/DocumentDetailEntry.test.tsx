import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DocumentOut } from "@/lib/types";
import DocumentDetailEntry from "./DocumentDetailEntry";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canAny: () => false }) }));

const document: DocumentOut = {
  id: "document-1", serial_number: "測試字第1150000001號", title: "測試主席令",
  urgency: "normal", classification: "normal", category: "decree", subject: null,
  content: "任命測試幹部，自即日起生效。", doc_description: null, action_required: null,
  handler_name: null, handler_unit: null, handler_email: null,
  status: "approved", current_step: 0, org_id: "org-1", created_by: "user-1",
  declassification_condition: "none", is_public: true, visibility_level: "publicly_open",
  issued_at: "2026-11-08T00:00:00Z", due_date: null, submitted_at: null, completed_at: null,
  created_at: "2026-11-08T00:00:00Z", updated_at: "2026-11-08T00:00:00Z",
  revisions: [], approvals: [], attachments: [], recipients: [],
};

describe("公文直連的首次 HTML", () => {
  it("伺服器取得公開資料後，無需執行 JavaScript 即有字號和令文", () => {
    const html = renderToString(<DocumentDetailEntry documentId={document.id} initialDoc={document} initialLoadStatus={200} />);
    expect(html).toContain("任命測試幹部，自即日起生效。");
    expect(html).toContain("測試字第1150000001號");
    expect(html).toContain('class="official-paper"');
    expect(html).not.toContain("正在載入公開公文");
  });
  it.each([404, 503, null])("伺服器回傳 %s 時，HTML 如實呈現結果而非永久載入", (status) => {
    const html = renderToString(<DocumentDetailEntry documentId={document.id} initialDoc={null} initialLoadStatus={status} />);
    expect(html).not.toContain("正在載入公開公文");
    expect(html).toContain(status === 404 ? "公文不存在" : "暫時無法載入公開公文");
    expect(html.includes("重新載入")).toBe(status !== 404);
  });
});
