import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import CouncilOrdersPage from "@/app/(protected)/shop/council-orders/page";

const api = vi.hoisted(() => ({
  catalog: vi.fn(), listActivities: vi.fn(), recipientOptions: vi.fn(),
  orderSummary: vi.fn(), getCloseStatus: vi.fn(), classPaymentReport: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: false, permissions: new Set(["shop:view_all"]) }),
}));
vi.mock("@/lib/api", () => ({ shopApi: api, classApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
vi.mock("@/components/shop/ShopSalesAnalytics", () => ({
  default: ({ filters }: { filters: Record<string, string> }) => <output aria-label="分析查詢">{JSON.stringify(filters)}</output>,
}));

beforeEach(() => {
  vi.resetAllMocks();
  api.catalog.mockResolvedValue([
    { id: "shirts", name: "服飾活動", series: [], products: [{ id: "shirt", name: "紀念衫" }] },
    { id: "cards", name: "傳情活動", series: [], products: [{ id: "card", name: "傳情卡" }] },
  ]);
  api.listActivities.mockResolvedValue([]);
  api.recipientOptions.mockResolvedValue([]);
  api.orderSummary.mockResolvedValue({ group_by: "class", rows: [], total_amount: 0, paid_amount: 0, unpaid_amount: 0 });
  api.getCloseStatus.mockResolvedValue({ statuses: {} });
  api.classPaymentReport.mockResolvedValue([]);
});

it("銷售分析預設單一活動，切換與清除篩選都不會合併活動", async () => {
  render(<CouncilOrdersPage />);
  await screen.findByRole("option", { name: "服飾活動" });
  fireEvent.click(screen.getByRole("button", { name: "銷售分析" }));
  const theme = screen.getByRole("combobox", { name: "分析活動" });
  expect(theme).toHaveValue("shirts");
  expect(screen.queryByRole("option", { name: "全部活動" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("分析查詢")).toHaveTextContent('"category_id":"shirts"');
  fireEvent.change(screen.getByRole("combobox", { name: "商品" }), { target: { value: "shirt" } });
  expect(screen.getByLabelText("分析查詢")).toHaveTextContent('"product_id":"shirt"');
  fireEvent.change(theme, { target: { value: "cards" } });
  expect(screen.getByLabelText("分析查詢")).toHaveTextContent('"category_id":"cards"');
  expect(screen.getByLabelText("分析查詢")).not.toHaveTextContent("product_id");
  expect(screen.queryByRole("option", { name: "紀念衫" })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "傳情卡" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "清除篩選" }));
  expect(screen.getByLabelText("分析查詢")).toHaveTextContent('"category_id":"shirts"');
});

it("活動載入前與沒有活動時不發出合併分析", async () => {
  let resolve!: (value: never[]) => void;
  api.catalog.mockReturnValueOnce(new Promise<never[]>((done) => { resolve = done; }));
  render(<CouncilOrdersPage />);
  fireEvent.click(screen.getByRole("button", { name: "銷售分析" }));
  expect(screen.queryByLabelText("分析查詢")).not.toBeInTheDocument();
  expect(screen.getByText("正在載入分析活動…")).toBeVisible();
  resolve([]);
  await waitFor(() => expect(screen.queryByText("正在載入分析活動…")).not.toBeInTheDocument());
  expect(screen.queryByLabelText("分析查詢")).not.toBeInTheDocument();
  expect(screen.getByText("尚無可分析的活動。")).toBeVisible();
});
