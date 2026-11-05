import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ProductOut } from "@/lib/types";
import ProductSizeChart from "./ProductSizeChart";
import ProductSizeChartEditor from "./ProductSizeChartEditor";

const updateProduct = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ shopApi: { updateProduct }, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
const product: Pick<ProductOut, "id" | "size_chart" | "variant_groups"> = {
  id: "shirt",
  variant_groups: [{ id: "size", product_id: "shirt", name: "尺寸", sort_order: 0,
    options: ["M", "L", "XL"].map((value) => ({ id: value, value, group_id: "size", image_url: null, price_delta: 0, sort_order: 0, is_active: true })) }],
  size_chart: { group_id: "size", columns: ["衣長（cm）", "胸寬（cm）"], rows: [
    { option_id: "M", values: ["68", "50"] }, { option_id: "L", values: ["72", "54"] },
  ], note: "平放測量" },
};

beforeEach(() => vi.resetAllMocks());

it("同步標示所選尺寸，切換後清除上一列標記，缺少資料會明示", () => {
  const view = render(<ProductSizeChart product={product} picked={{ size: "M" }} />);
  expect(screen.getByRole("status")).toHaveTextContent("已選 M：衣長（cm） 68、胸寬（cm） 50");
  expect(screen.getByRole("row", { name: "M 已選 68 50" })).toHaveAttribute("data-selected", "true");
  view.rerender(<ProductSizeChart product={product} picked={{ size: "L" }} />);
  expect(screen.getByRole("row", { name: "M 68 50" })).toHaveAttribute("data-selected", "false");
  expect(screen.getByRole("row", { name: "L 已選 72 54" })).toHaveAttribute("data-selected", "true");
  view.rerender(<ProductSizeChart product={product} picked={{ size: "XL" }} />);
  expect(screen.getByRole("status")).toHaveTextContent("XL 尚未提供尺寸資料");
});

it("點擊尺寸表的尺寸會觸發規格選擇", () => {
  const onSelectOption = vi.fn();
  render(<ProductSizeChart product={product} onSelectOption={onSelectOption} />);
  fireEvent.click(screen.getByRole("button", { name: "L" }));
  expect(onSelectOption).toHaveBeenCalledWith("size", "L");
});

it("隱藏沒有尺寸表、已刪規格與停用選項，沿用選項的新名稱", () => {
  const view = render(<ProductSizeChart product={{ ...product, size_chart: null }} />);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  view.rerender(<ProductSizeChart product={{ ...product, variant_groups: [] }} />);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  view.rerender(<ProductSizeChart product={{ ...product, variant_groups: [{ ...product.variant_groups[0], options:
    product.variant_groups[0].options.map((option) => ({ ...option, value: `${option.value}號`, is_active: option.id !== "L" })) }] }} />);
  expect(screen.getByRole("rowheader", { name: "M號" })).toBeVisible();
  expect(screen.queryByRole("rowheader", { name: "L號" })).not.toBeInTheDocument();
});

it("失敗保留輸入，重試儲存以尺寸 ID 綁定，空白尺寸不送出", async () => {
  const changed = vi.fn();
  updateProduct.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(product);
  render(<ProductSizeChartEditor product={product} onChanged={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "編輯尺寸表" }));
  fireEvent.change(screen.getByRole("textbox", { name: "M 衣長（cm）" }), { target: { value: "69" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存尺寸表" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("尺寸表尚未儲存");
  expect(alert).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "M 衣長（cm）" })).toHaveValue("69");
  fireEvent.click(screen.getByRole("button", { name: "儲存尺寸表" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(updateProduct).toHaveBeenLastCalledWith("shirt", { size_chart: { ...product.size_chart,
    rows: [{ option_id: "M", values: ["69", "50"] }, { option_id: "L", values: ["72", "54"] }] } });
});

it("拒絕不完整的資料，移除欄位後對應資料會一起移除", async () => {
  render(<ProductSizeChartEditor product={product} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "編輯尺寸表" }));
  fireEvent.change(screen.getByRole("textbox", { name: "XL 衣長（cm）" }), { target: { value: "76" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存尺寸表" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("完整資料");
  expect(updateProduct).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "移除第 2 欄" }));
  expect(screen.queryByRole("textbox", { name: "M 胸寬（cm）" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "儲存尺寸表" }));
  await waitFor(() => expect(updateProduct).toHaveBeenCalledWith("shirt", { size_chart: {
    group_id: "size", columns: ["衣長（cm）"], note: "平放測量", rows: [
      { option_id: "M", values: ["68"] }, { option_id: "L", values: ["72"] }, { option_id: "XL", values: ["76"] },
    ],
  } }));
});

it("移除尺寸表送出 null，沒有規格時顯示下一步並禁止儲存", async () => {
  updateProduct.mockResolvedValue({});
  const view = render(<ProductSizeChartEditor product={product} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "編輯尺寸表" }));
  fireEvent.click(screen.getByRole("button", { name: "移除尺寸表" }));
  await waitFor(() => expect(updateProduct).toHaveBeenCalledWith("shirt", { size_chart: null }));
  view.unmount();
  render(<ProductSizeChartEditor product={{ id: "empty", variant_groups: [], size_chart: null }} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "新增尺寸表" }));
  expect(screen.getByText(/請先在上方新增/)).toBeVisible();
  expect(within(screen.getByRole("region", { name: "商品尺寸表設定" })).getByRole("button", { name: "儲存尺寸表" })).toBeDisabled();
});

it("開啟、取消、儲存及移除後保留鍵盤焦點並宣告結果", async () => {
  updateProduct.mockResolvedValue({});
  const view = render(<ProductSizeChartEditor product={product} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "編輯尺寸表" }));
  expect(screen.getByRole("combobox", { name: "對應規格類別" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByRole("button", { name: "編輯尺寸表" })).toHaveFocus();
  expect(screen.getByText("已取消尺寸表編輯。")).toHaveAttribute("role", "status");
  fireEvent.click(screen.getByRole("button", { name: "編輯尺寸表" }));
  fireEvent.click(screen.getByRole("button", { name: "儲存尺寸表" }));
  await screen.findByText("尺寸表已儲存。");
  await waitFor(() => expect(screen.getByRole("button", { name: "編輯尺寸表" })).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "編輯尺寸表" }));
  fireEvent.click(screen.getByRole("button", { name: "移除尺寸表" }));
  await screen.findByText("尺寸表已移除。");
  view.rerender(<ProductSizeChartEditor product={{ ...product, size_chart: null }} onChanged={vi.fn()} />);
  expect(screen.getByRole("button", { name: "新增尺寸表" })).toHaveFocus();
  expect(screen.getByText("尺寸表已移除。")).toHaveAttribute("role", "status");
});
