import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AnnouncementOut, CatalogCategoryOut, CatalogProductOut, PublicSiteBundleOut } from "@/lib/types";
import HomeContent, { HomeEntrySection } from "./HomeContent";

vi.mock("@/components/site/LiveElectionCard", () => ({ default: () => null }));

const urgent: AnnouncementOut = {
  id: "notice-1", title: "校園活動預購公告", audience_type: "all", author_id: "author",
  author_name: "班聯會", created_at: "2026-11-01T08:00:00Z", updated_at: "2026-11-01T08:00:00Z",
  published_at: "2026-11-01T08:00:00Z", is_published: true, is_urgent: true,
  urgent_until: null, org_id: null, content: {}, media: [], audience_members: [], audience_orgs: [],
  link_label: "前往預購", link_url: "/shop", show_on_every_visit: false,
};
const product: CatalogProductOut = {
  id: "bag", name: "活動紀念袋", price: 100, status: "active", stock_quantity: 10,
  is_unlimited: false, purchase_allowed: true, has_variants: false,
  has_option_surcharge: false, requires_seating: false,
};
const category: CatalogCategoryOut = {
  id: "event", name: "校園活動", sort_order: 0, products: [product],
  series: [{ id: "series", name: "紀念品", sort_order: 0, products: [product] }],
};
const props = {
  bundle: null, announcements: [], urgentAnnouncement: null, openSurveys: [],
  catalog: [], shopUnavailable: false,
};

it("shows an urgent announcement once and keeps its configured destination", () => {
  render(<HomeContent {...props} urgentAnnouncement={urgent} announcements={[urgent]} />);
  expect(screen.getAllByRole("link", { name: urgent.title })).toHaveLength(1);
  expect(screen.getByRole("link", { name: urgent.title })).toHaveAttribute("href", "/shop");
});

it("does not promote an announcement whose urgent deadline has passed", () => {
  const expired = { ...urgent, urgent_until: "2000-01-01T00:00:00Z" };
  render(<HomeContent {...props} urgentAnnouncement={expired} announcements={[expired]} />);
  expect(screen.queryByText(urgent.title)).not.toBeInTheDocument();
  expect(screen.getByText("目前沒有新公告")).toBeVisible();
});

it("distinguishes an unavailable announcement service from an empty list", () => {
  render(<HomeContent {...props} announcementsAvailable={false} />);
  expect(screen.getByRole("alert")).toHaveTextContent("無法取得最新公告");
  expect(screen.getByRole("button", { name: "重新載入" })).toBeVisible();
  expect(screen.queryByText("目前沒有新公告")).not.toBeInTheDocument();
});

describe("activity products", () => {
  it("lists a product once even when it belongs to a category and series", () => {
    render(<HomeContent {...props} catalog={[category]} />);
    expect(screen.getAllByRole("link", { name: /活動紀念袋/ })).toHaveLength(1);
  });
  it("hides the product section when the shop is unavailable", () => {
    render(<HomeContent {...props} catalog={[category]} shopUnavailable />);
    expect(screen.queryByRole("heading", { name: "活動商品" })).not.toBeInTheDocument();
  });
});

it("honors hidden and renamed common services from the site configuration", () => {
  const bundle: PublicSiteBundleOut = {
    featured_officers: [], link_categories: [], links: [], nav_pages: [],
    settings: {
      id: "site", created_at: "2026-11-01T08:00:00Z", updated_at: "2026-11-01T08:00:00Z",
      site_title: "班聯會", hero_title: "班聯會", about_title: "關於班聯會", about_body_md: "",
      cta_href: "/news", cta_label: "公告", public_database_label: "公開資料",
      theme_config: { nav: { items: { petitions: { hidden: true }, "public-db": { label: "自治資料" } } } },
    },
  };
  render(<HomeEntrySection bundle={bundle} />);
  expect(screen.queryByRole("link", { name: "公開陳情" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "自治資料" })).toHaveAttribute("href", "/public");
});
