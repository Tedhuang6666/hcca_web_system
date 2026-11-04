import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ShopPage from "@/app/(protected)/shop/page";
import { cachePurge } from "@/lib/api-cache";
import { ApiError } from "@/lib/api-helpers";

const api = vi.hoisted(() => ({
  me: vi.fn(), catalog: vi.fn(), getCurrentRegistrations: vi.fn(), listAvailablePromotions: vi.fn(),
  getProduct: vi.fn(), getCloseStatus: vi.fn(), myClass: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  authApi: { refresh: api.me }, shopApi: api, classApi: { myClass: api.myClass },
  apiErrorMessage: (error: Error) => error.message,
}));
vi.mock("@/hooks/useWS", () => ({ useWS: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const product = {
  id: "formal", name: "總覽商品", price: 100, image_url: null, status: "active",
  is_unlimited: true, stock_quantity: 0, has_variants: false, has_option_surcharge: false,
  requires_seating: false, sale_start: null, sale_end: null,
};
const catalog = [{ id: "goods", name: "校慶商品", activity_id: "festival",
  sort_order: 0, products: [product], series: [] }];

beforeEach(() => {
  vi.resetAllMocks();
  cachePurge();
  window.history.replaceState({}, "", "/shop");
  api.me.mockResolvedValue({ id: "student-a", student_id: "310001" });
  api.catalog.mockResolvedValue(catalog);
  api.myClass.mockResolvedValue(null);
  api.getCloseStatus.mockResolvedValue({ statuses: {} });
  api.getCurrentRegistrations.mockResolvedValue([]);
  api.listAvailablePromotions.mockResolvedValue([]);
  api.getProduct.mockResolvedValue({ ...product, variant_groups: [], media: [] });
});
afterEach(() => cachePurge());

it("shows overview products before the class lookup finishes and blocks purchasing until it does", async () => {
  let finishClass!: (value: { id: string; label: string }) => void;
  api.myClass.mockReturnValue(new Promise((resolve) => { finishClass = resolve; }));
  render(<ShopPage />);

  fireEvent.click(await screen.findByRole("link", { name: "查看商品：總覽商品" }));
  expect(await screen.findByRole("button", { name: "登記購買 · NT$100" })).toBeDisabled();
  expect(screen.getByText("正在確認活動結單狀態…")).toBeVisible();

  await act(async () => { finishClass({ id: "class-a", label: "一年一班" }); });
  await waitFor(() => expect(screen.getByRole("button", { name: "登記購買 · NT$100" })).toBeEnabled());
});

it("keeps products browsable when class lookup fails, with purchasing disabled", async () => {
  api.myClass.mockRejectedValue(new Error("class unavailable"));
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：總覽商品" }));
  expect(await screen.findByRole("button", { name: "登記購買 · NT$100" })).toBeDisabled();
});

it("restores a verified account's overview while refreshing and retains it on a failed refresh", async () => {
  const first = render(<ShopPage />);
  await screen.findByRole("link", { name: "查看商品：總覽商品" });
  first.unmount();

  let failRefresh!: (error: Error) => void;
  api.catalog.mockReturnValue(new Promise((_, reject) => { failRefresh = reject; }));
  render(<ShopPage />);
  expect(await screen.findByRole("link", { name: "查看商品：總覽商品" })).toBeVisible();
  expect(api.catalog).toHaveBeenCalledTimes(2);
  await act(async () => { failRefresh(new Error("catalog unavailable")); });
  expect(screen.getByRole("link", { name: "查看商品：總覽商品" })).toBeVisible();
  expect(screen.getByText("目前無法載入商品，請稍後重試。")).toBeVisible();
});

it.each(["other-account", "public", "auth-unavailable", "expired"])(
  "does not restore catalog data for %s", async (scenario) => {
    const first = render(<ShopPage />);
    await screen.findByRole("link", { name: "查看商品：總覽商品" });
    first.unmount();
    if (scenario === "other-account") api.me.mockResolvedValue({ id: "student-b", student_id: "310002" });
    if (scenario === "public") api.me.mockRejectedValue(new ApiError(401, "not logged in"));
    if (scenario === "auth-unavailable") api.me.mockRejectedValue(new ApiError(503, "auth unavailable"));
    if (scenario === "expired") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    api.catalog.mockReturnValue(new Promise(() => {}));
    render(<ShopPage />);
    await waitFor(() => expect(api.catalog).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("link", { name: "查看商品：總覽商品" })).not.toBeInTheDocument();
  },
);
