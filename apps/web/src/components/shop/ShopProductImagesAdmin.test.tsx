import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ShopAdminPage from "@/app/(protected)/shop/admin/page";

const api = vi.hoisted(() => ({
  listCategories: vi.fn(), listProducts: vi.fn(), listSeries: vi.fn(), createProduct: vi.fn(),
  updateProduct: vi.fn(), getProduct: vi.fn(), uploadImage: vi.fn(), updateVariantOption: vi.fn(),
  getProductPurchaseRules: vi.fn(), purchasePermissions: vi.fn(), purchaseGroupOptions: vi.fn(),
  getProductCost: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  api.listCategories.mockResolvedValue([{ id: "cat", name: "舞會" }]);
  api.listSeries.mockResolvedValue([]);
  api.listProducts.mockResolvedValue([]);
  api.getProductCost.mockResolvedValue({ unit_cost: null });
  api.getProductPurchaseRules.mockResolvedValue({ allowed_grades: [], required_permissions: [], allowed_identifiers: [], blocked_identifiers: [], exclusive_group: null, designated_only: false });
  api.purchasePermissions.mockResolvedValue([]);
  api.purchaseGroupOptions.mockResolvedValue([]);
});

afterEach(() => vi.restoreAllMocks());

it("儲存主圖標註與新選項對應圖片，移除照片會清除對應", async () => {
  api.uploadImage.mockResolvedValueOnce({ url: "/front.png" }).mockResolvedValueOnce({ url: "/badge.png" });
  api.createProduct.mockRejectedValue(new Error("offline"));
  render(<ShopAdminPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: "新增商品" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "新增商品" }));
  fireEvent.change(screen.getByLabelText("商品名稱"), { target: { value: "舞會門票" } });
  await act(async () => fireEvent.change(screen.getByLabelText("一次選取多張商品照片"), { target: {
    files: [new File(["front"], "front.png", { type: "image/png" }), new File(["badge"], "badge.png", { type: "image/png" })],
  } }));
  fireEvent.change(screen.getByLabelText("第 1 張照片標註（選填）"), { target: { value: "正面" } });
  fireEvent.change(screen.getByLabelText("第 2 張照片標註（選填）"), { target: { value: "徽章" } });
  fireEvent.click(screen.getByRole("button", { name: "加入自訂規格" }));
  fireEvent.change(screen.getByLabelText("規格 1 名稱"), { target: { value: "組合" } });
  fireEvent.change(screen.getByLabelText("規格 1 選項（逗號或換行分隔）"), { target: { value: "門票, 徽章:50" } });
  fireEvent.change(screen.getByLabelText("組合・徽章 圖片"), { target: { value: "/badge.png" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
  await waitFor(() => expect(api.createProduct).toHaveBeenCalledWith(expect.objectContaining({
    image_url: "/front.png",
    media: [
      { image_url: "/front.png", label: "正面", kind: "product", sort_order: 0 },
      { image_url: "/badge.png", label: "徽章", kind: "product", sort_order: 1 },
    ],
    variant_groups: [expect.objectContaining({ options: [
      expect.objectContaining({ value: "門票", image_url: null }),
      expect.objectContaining({ value: "徽章", image_url: "/badge.png" }),
    ] })],
  })));
  fireEvent.click(screen.getByRole("button", { name: "移除第 2 張照片" }));
  expect(screen.getByLabelText("組合・徽章 圖片")).toHaveValue("");
});

it("舊主圖可補標註，修改商品不會丟失主圖標註", async () => {
  const product = { id: "old", category_id: "cat", name: "舞會門票", price: 100, status: "draft",
    image_url: "/front.png", media: [], variant_groups: [] };
  api.listProducts.mockResolvedValue([product]);
  api.updateProduct.mockRejectedValue(new Error("offline"));
  render(<ShopAdminPage />);
  fireEvent.click(await screen.findByRole("button", { name: /舞會/ }));
  fireEvent.click((await screen.findAllByRole("button", { name: "編輯" }))[0]);
  fireEvent.change(screen.getByLabelText("第 1 張照片標註（選填）"), { target: { value: "正面" } });
  await screen.findByText("購買資格");
  fireEvent.click(screen.getByRole("button", { name: "儲存商品" }));
  await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith("old", expect.objectContaining({
    image_url: "/front.png", media: [{ image_url: "/front.png", label: "正面", kind: "product", sort_order: 0 }],
  })));
});

it("既有選項可直接選用有標註的商品照片", async () => {
  const product = { id: "old", category_id: "cat", name: "舞會門票", price: 100, status: "draft",
    image_url: "/front.png", media: [{ id: "badge-photo", image_url: "/badge.png", label: "徽章", kind: "product" }],
    variant_groups: [{ id: "group", name: "組合", options: [{ id: "badge", value: "徽章", price_delta: 50, image_url: null, is_active: true }] }] };
  api.listProducts.mockResolvedValue([product]);
  api.getProduct.mockResolvedValue(product);
  render(<ShopAdminPage />);
  fireEvent.click(await screen.findByRole("button", { name: /舞會/ }));
  fireEvent.click((await screen.findAllByRole("button", { name: /舞會門票/ }))[0]);
  fireEvent.click(await screen.findByRole("button", { name: "編輯徽章" }));
  fireEvent.change(screen.getByLabelText("使用商品照片"), { target: { value: "/badge.png" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存" }));
  await waitFor(() => expect(api.updateVariantOption).toHaveBeenCalledWith("badge", expect.objectContaining({ image_url: "/badge.png" })));
});

it("選項圖片上傳完成前停用儲存，完成後保存上傳的圖片", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:badge-preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const product = { id: "old", category_id: "cat", name: "舞會門票", price: 100, status: "draft",
    image_url: null, media: [], variant_groups: [{ id: "group", name: "加購", options: [
      { id: "badge", value: "徽章", price_delta: 50, image_url: null, is_active: true },
    ] }] };
  api.listProducts.mockResolvedValue([product]);
  api.getProduct.mockResolvedValue(product);
  let finish!: (result: { url: string }) => void;
  api.uploadImage.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<ShopAdminPage />);
  fireEvent.click(await screen.findByRole("button", { name: /舞會/ }));
  fireEvent.click((await screen.findAllByRole("button", { name: /舞會門票/ }))[0]);
  fireEvent.click(await screen.findByRole("button", { name: "編輯徽章" }));
  const modal = within(screen.getByRole("dialog", { name: "編輯選項" }));
  fireEvent.change(modal.getByLabelText(/拖曳商品圖片到這裡/), { target: {
    files: [new File(["badge"], "badge.png", { type: "image/png" })],
  } });
  expect(modal.getByRole("button", { name: "圖片上傳中…" })).toBeDisabled();
  expect(api.updateVariantOption).not.toHaveBeenCalled();
  await act(async () => finish({ url: "/uploaded-badge.png" }));
  fireEvent.click(modal.getByRole("button", { name: "儲存" }));
  await waitFor(() => expect(api.updateVariantOption).toHaveBeenCalledWith("badge", expect.objectContaining({ image_url: "/uploaded-badge.png" })));
});
