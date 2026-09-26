import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExamScopeData } from "@/lib/exam-scope";
import { usersApi } from "@/lib/api/users";

import ExamScopeExplorer from "./ExamScopeExplorer";

vi.mock("@/lib/api/users", () => ({
  usersApi: { me: vi.fn() },
}));

vi.mock("./ArticleMarkdown", () => ({
  default: ({ markdown }: { markdown: string }) => <p>{markdown}</p>,
}));

const scope: ExamScopeData = {
  subjects: ["國文", "生物"],
  grades: ["高一", "高二"],
  sections: ["計分方式", "一段", "二段"],
  entries: [
    {
      id: "biology-1",
      subject: "生物",
      section: "一段",
      grade: "高一",
      gradeGroup: "高一",
      content: "動物體的組成",
    },
    {
      id: "biology-2",
      subject: "生物",
      section: "二段",
      grade: "高一",
      gradeGroup: "高一",
      content: "呼吸系統",
    },
  ],
};

const mathScope: ExamScopeData = {
  subjects: ["數學"],
  grades: ["高二", "高三"],
  sections: ["一段"],
  entries: [
    {
      id: "math-2a",
      subject: "數學",
      section: "一段",
      grade: "高二－數A",
      gradeGroup: "高二",
      content: "指數函數",
    },
    {
      id: "math-2b",
      subject: "數學",
      section: "一段",
      grade: "高二－數B",
      gradeGroup: "高二",
      content: "第一單元",
    },
    {
      id: "math-3a",
      subject: "數學",
      section: "一段",
      grade: "高三－數學甲",
      gradeGroup: "高三",
      content: "複數與方程式",
    },
    {
      id: "math-3b",
      subject: "數學",
      section: "一段",
      grade: "高三－數學乙",
      gradeGroup: "高三",
      content: "複數平面",
    },
  ],
};

describe("ExamScopeExplorer", () => {
  beforeEach(() => {
    vi.mocked(usersApi.me).mockRejectedValue(new Error("not signed in"));
  });

  it("uses the configured stage by default and restores it after reset", () => {
    render(<ExamScopeExplorer scope={scope} defaultSection="一段" />);

    expect(screen.getByRole("button", { name: "依年級" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "一段" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "依科目" }));
    fireEvent.click(screen.getByRole("button", { name: "二段" }));
    fireEvent.click(screen.getByRole("button", { name: "重設查詢" }));

    expect(screen.getByRole("button", { name: "依年級" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "一段" })).toHaveAttribute("aria-pressed", "true");
  });

  it("prefills a recognised signed-in student's grade without repeating it in each result", async () => {
    vi.mocked(usersApi.me).mockResolvedValue({ student_id: "05123456" } as never);

    render(<ExamScopeExplorer scope={scope} defaultSection="一段" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "高一" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.queryByRole("heading", { name: "高一", level: 5 })).not.toBeInTheDocument();
    expect(screen.getByText("動物體的組成")).toBeInTheDocument();
  });

  it("keeps math variants visible when filtering by grade", () => {
    render(<ExamScopeExplorer scope={mathScope} />);

    fireEvent.click(screen.getByRole("button", { name: "數學" }));
    fireEvent.click(screen.getByRole("button", { name: "高二" }));

    expect(screen.getByRole("heading", { name: "數學（數A）", level: 5 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "數學（數B）", level: 5 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "數學（數學甲）", level: 5 })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "依科目" }));
    expect(screen.getByRole("heading", { name: "數A", level: 5 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "數B", level: 5 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "高三" }));
    expect(screen.getByRole("heading", { name: "數學甲", level: 5 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "數學乙", level: 5 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "依年級" }));
    expect(screen.getByRole("heading", { name: "數學（數學甲）", level: 5 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "數學（數學乙）", level: 5 })).toBeInTheDocument();
  });
});
