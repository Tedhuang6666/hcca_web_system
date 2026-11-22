import { describe, expect, it } from "vitest";

import type { PublicLinkCategoryOut, PublicLinkOut } from "@/lib/types";
import { groupPublicLinks } from "./public-link-groups";

function category(id: string, title: string): PublicLinkCategoryOut {
  return {
    id,
    title,
    slug: id,
    description: null,
    sort_order: 0,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function link(id: string, category: PublicLinkCategoryOut | null): PublicLinkOut {
  return {
    id,
    title: id,
    url: `https://example.com/${id}`,
    description: null,
    category_id: category?.id ?? null,
    category,
    icon_key: null,
    sort_order: 0,
    is_active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("groupPublicLinks", () => {
  it("follows category order, preserves new categories, and puts unassigned links last", () => {
    const first = category("first", "第一分類");
    const second = category("second", "第二分類");
    const notYetListed = category("new", "新分類");
    const groups = groupPublicLinks(
      [second, first],
      [link("first-link", first), link("unassigned", null), link("second-link", second), link("new-link", notYetListed)],
    );

    expect(groups.map((group) => group.id)).toEqual(["second", "first", "new", "uncategorized"]);
    expect(groups.map((group) => group.title)).toEqual(["第二分類", "第一分類", "新分類", "其他連結"]);
    expect(groups.map((group) => group.links.map((item) => item.id))).toEqual([
      ["second-link"],
      ["first-link"],
      ["new-link"],
      ["unassigned"],
    ]);
  });
});
