import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RegulationRevisionOut } from "@/lib/types";
import { RevisionCard } from "./RegulationDetailSections";

describe("法規修訂歷程", () => {
  it("只顯示修訂摘要，不顯示已移除的收錄者或提案資料", () => {
    const revision: RegulationRevisionOut = {
      id: "revision-1", regulation_id: "regulation-1", version: 1,
      change_brief: "114 學年度第二學期第四次學生議會修訂", is_total_amendment: false,
      content_snapshot: "", article_snapshot: null, resolution_link: null,
      amended_at: "2025-01-01T00:00:00Z", amended_at_precision: "year", amended_year: 114,
    };
    render(<RevisionCard rev={revision} prevRev={null} currentRev={revision} onDiff={() => {}} />);

    expect(screen.getByText(revision.change_brief)).toBeInTheDocument();
    expect(screen.queryByText(/系統收錄者/)).not.toBeInTheDocument();
    expect(screen.queryByText("修正摘要")).not.toBeInTheDocument();
    expect(screen.queryByText("提案內容")).not.toBeInTheDocument();
    expect(screen.queryByText("此版本未留存提案說明")).not.toBeInTheDocument();
  });
});
