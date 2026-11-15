import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RegulationRevisionOut } from "@/lib/types";
import { RevisionCard } from "./RegulationDetailSections";

describe("歷史沿革的系統收錄者", () => {
  it("明確區別收錄人員與來源修訂機關，不以 UUID 代替未知姓名", () => {
    const revision: RegulationRevisionOut = {
      id: "revision-1", regulation_id: "regulation-1", version: 1,
      change_brief: "108.9.4 學生議會秘書處修訂", is_total_amendment: false,
      content_snapshot: "", resolution_link: null, amended_at: "2019-09-04T00:00:00Z", amended_at_precision: "date",
      amended_by: "system-uploader-uuid", amended_by_name: "測試收錄人員",
      created_at: "2026-11-13T00:00:00Z",
    };
    const view = render(<RevisionCard rev={revision} prevRev={null} currentRev={revision} onDiff={() => {}} />);
    expect(screen.getByText(/系統收錄者：測試收錄人員（115.11.13收錄）/)).toBeInTheDocument();
    expect(screen.getAllByText(revision.change_brief).length).toBeGreaterThan(0);
    view.rerender(<RevisionCard rev={{ ...revision, amended_by_name: null }} prevRev={null} currentRev={revision} onDiff={() => {}} />);
    expect(screen.getByText(/系統收錄者：未載明/)).toBeInTheDocument();
    expect(screen.queryByText(/system-uploader-uuid/)).not.toBeInTheDocument();
  });
});
