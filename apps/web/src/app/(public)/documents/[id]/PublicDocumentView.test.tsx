import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocumentOut } from "@/lib/types";
import PublicDocumentView from "./PublicDocumentView";

const baseDocument: DocumentOut = {
  id: "document-1", serial_number: "測試字第1150000001號", title: "測試公文",
  urgency: "normal", classification: "normal", category: "decree", subject: "依法發布測試事項。",
  content: "核定內容。", doc_description: "核定內容。", action_required: null,
  handler_name: "承辦測試人", handler_unit: null, handler_email: null,
  status: "approved", current_step: 1, org_id: "org-1", created_by: "user-1",
  declassification_condition: "none", is_public: true, visibility_level: "publicly_open",
  issued_at: "2026-11-08T18:00:00Z", due_date: null, submitted_at: null, completed_at: null,
  created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-08T18:00:00Z",
  revisions: [], approvals: [], attachments: [], recipients: [],
};

describe("公開正式公文閱讀", () => {
  it("呈現原始主旨、依據與正文，不由承辦人補造簽章", () => {
    render(<PublicDocumentView document={{ ...baseDocument, basis: "本會組織章程。" }} canDownloadPdf />);
    expect(screen.getByText("依法發布測試事項。")).toBeInTheDocument();
    expect(screen.getByText("本會組織章程。")).toBeInTheDocument();
    expect(screen.getByText("核定內容。")).toBeInTheDocument();
    expect(screen.queryByText("承辦測試人")).not.toBeInTheDocument();
    expect(screen.queryByText("（蓋章處）")).not.toBeInTheDocument();
    expect(screen.queryByText("已核准")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下載公文 PDF" })).toBeInTheDocument();
  });

  it("發文日期依臺北時區，缺漏時不改用建檔日期", () => {
    const view = render(<PublicDocumentView document={baseDocument} />);
    expect(screen.getByText("中華民國115年11月9日")).toBeInTheDocument();
    view.rerender(<PublicDocumentView document={{ ...baseDocument, issued_at: null }} />);
    expect(view.container.querySelector(".official-paper time")).toHaveTextContent("未載明");
    expect(screen.queryByText("中華民國115年11月1日")).not.toBeInTheDocument();
  });

  it("上傳附件提供實際下載連結，長檔名不被截斷", () => {
    render(<PublicDocumentView document={{ ...baseDocument, attachments: [{ id: "attachment-1", filename: "正式附件.pdf", link_url: null, display_name: "核定附件完整名稱.pdf", file_size: 100, created_at: baseDocument.created_at, uploaded_by: "user-1", quantity: 1, url: "" }] }} />);
    expect(screen.getByRole("link", { name: "核定附件完整名稱.pdf" })).toHaveAttribute("href", "/api/documents/document-1/attachments/attachment-1/download");
  });

  it("載入失敗提供重試，查無文件提供返回查詢", () => {
    const retry = vi.fn();
    const view = render(<PublicDocumentView document={null} loadError="unavailable" onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "重新載入" }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<PublicDocumentView document={null} loadError="not_found" />);
    expect(screen.queryByRole("button", { name: "重新載入" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回公文查詢" })).toHaveAttribute("href", "/documents");
  });

  it("可以調整公文字級，正文保有獨立的閱讀縮放", () => {
    const view = render(<PublicDocumentView document={baseDocument} />);
    fireEvent.click(screen.getByRole("button", { name: "放大公文字級" }));
    expect(view.container.querySelector(".official-paper")).toHaveStyle("--reader-font-scale: 1.1");
    fireEvent.click(screen.getByRole("button", { name: "縮小公文字級" }));
    expect(view.container.querySelector(".official-paper")).toHaveStyle("--reader-font-scale: 1");
  });

  it("匿名閱讀明示 PDF 需要登入，仍提供本文列印", () => {
    render(<PublicDocumentView document={baseDocument} />);
    expect(screen.getByRole("link", { name: "登入下載 PDF" })).toHaveAttribute("href",
      `/login?next=${encodeURIComponent(`/documents/${encodeURIComponent(baseDocument.serial_number)}`)}`);
    expect(screen.queryByRole("button", { name: "下載公文 PDF" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "列印本文" })).toBeInTheDocument();
  });
});
