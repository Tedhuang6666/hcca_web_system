import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CouncilOrdersPage from "@/app/(protected)/shop/council-orders/page";

const api = vi.hoisted(() => ({
  catalog: vi.fn(), listActivities: vi.fn(), recipientOptions: vi.fn(), orderSummary: vi.fn(), orderQuantities: vi.fn(),
  classPaymentReport: vi.fn(), classRepresentativeReminderTargets: vi.fn(), createMessage: vi.fn(),
  listSupplementOrders: vi.fn(),
  listOrderRecipients: vi.fn(),
  listOrders: vi.fn(), getCloseStatus: vi.fn(), closeCategory: vi.fn(), reopenCategory: vi.fn(), setClassPaid: vi.fn(),
  cancelOrder: vi.fn(), updateOrderItemQuantity: vi.fn(), downloadClassReceipt: vi.fn(), downloadClassReceipts: vi.fn(), downloadChangedOrderReceipts: vi.fn(),
}));
const access = vi.hoisted(() => ({ isAdmin: true, permissions: new Set<string>() }));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/api", () => ({ shopApi: api, classApi: api, emailApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => access }));
vi.mock("sonner", () => ({ toast: notifications }));

const summary = (label = "一年一班") => ({ group_by: "class", total_amount: 300, paid_amount: 0, unpaid_amount: 300,
  rows: [{ key: "class", label, order_count: 1, item_count: 1, total_amount: 300, paid_amount: 0, unpaid_amount: 300 }] });

beforeEach(() => {
  vi.resetAllMocks();
  access.isAdmin = true;
  access.permissions = new Set();
  api.catalog.mockResolvedValue([
    { id: "shirts", name: "衣服", activity_id: "festival", activity_name: "校慶", series: [], products: [{ id: "shirt", name: "紀念衫" }] },
    { id: "bags", name: "袋子", activity_id: "festival", activity_name: "校慶", series: [], products: [] },
    { id: "cards", name: "卡片", activity_id: "winter", activity_name: "冬季活動", series: [], products: [] },
  ]);
  api.listActivities.mockResolvedValue([
    { id: "festival", name: "校慶" },
    { id: "winter", name: "冬季活動" },
  ]);
  api.recipientOptions.mockResolvedValue([]);
  api.orderSummary.mockResolvedValue(summary());
  api.classPaymentReport.mockResolvedValue([]);
  api.classRepresentativeReminderTargets.mockResolvedValue([]);
  api.createMessage.mockResolvedValue({ id: "reminder-draft-id" });
  api.listSupplementOrders.mockResolvedValue([]);
  api.orderQuantities.mockResolvedValue([]);
  api.listOrders.mockResolvedValue([]);
  api.getCloseStatus.mockResolvedValue({ statuses: { shirts: { is_closed: false }, bags: { is_closed: false }, cards: { is_closed: false } } });
  api.closeCategory.mockResolvedValue({});
  api.setClassPaid.mockResolvedValue({ updated_orders: 1 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

async function openPage() {
  await act(async () => { render(<CouncilOrdersPage />); });
  fireEvent.click(screen.getByText(/更多篩選：/));
}

it("班級部分收款後立即更新補收款區，補齊後重新載入班級名單", async () => {
  api.orderSummary.mockResolvedValue({ ...summary(), rows: [{ ...summary().rows[0], total_amount: 3000, unpaid_amount: 3000 }] });
  api.setClassPaid.mockImplementation(async (_id, _paid, _activity, _category, collection) => {
    const paid = collection.received_amount ?? 3000;
    api.listSupplementOrders.mockResolvedValue([{ id: "balance", class_id: "class", supplement_class_id: "class", class_label: "一年一班",
      activity_id: "festival", activity_name: "校慶", is_class_balance: true, is_paid: paid === 3000, total_price: 3000, received_amount: paid }]);
    api.orderSummary.mockResolvedValue({ ...summary(), rows: [{ ...summary().rows[0], total_amount: 3000, paid_amount: paid, unpaid_amount: 3000 - paid }] });
    return {};
  });
  await openPage();
  const workspace = screen.getByRole("region", { name: "登記班級收款" });
  fireEvent.click(within(workspace).getByRole("radio", { name: "校慶" }));
  fireEvent.click(await within(workspace).findByRole("button", { name: "核對一年一班收款" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "本次實收金額（元）" }), { target: { value: "2000" } });
  fireEvent.click(screen.getByRole("button", { name: "確認收到款項" }));
  await screen.findByText(/剩餘 NT\$1,000 已列入補收款區/);
  switchTask("追加補收款");
  const balances = await screen.findByRole("list", { name: "整班尾款" });
  fireEvent.click(within(balances).getByRole("button", { name: "收齊尾款 NT$1,000" }));
  await screen.findByText("已收齊該班的整班尾款。");
  switchTask("班級繳款");
  expect(await within(screen.getByRole("region", { name: "登記班級收款" })).findByText("已收齊")).toBeVisible();
});

function switchTask(name: string) {
  fireEvent.click(within(screen.getByRole("navigation", { name: "班聯統籌工作" }))
    .getByRole("button", { name }));
}

it("依工作切換內容，切回代訂保留未送出的資料", async () => {
  await openPage();
  expect(screen.getByRole("navigation", { name: "班聯統籌工作" })).toHaveTextContent("追加補收款");
  expect(screen.getByRole("region", { name: "登記班級收款" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "每日收款" })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "代訂班級" })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "收據活動" })).not.toBeInTheDocument();

  switchTask("幫同學代訂");
  expect(screen.getByRole("combobox", { name: "代訂班級" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "統計範圍" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "代訂備註（選填）" }), { target: { value: "下課再確認尺寸" } });
  switchTask("追加補收款");
  expect(await screen.findByRole("heading", { name: "追加訂單補收款" })).toBeVisible();
  switchTask("幫同學代訂");
  expect(screen.getByRole("textbox", { name: "代訂備註（選填）" })).toHaveValue("下課再確認尺寸");
  expect(within(screen.getByRole("navigation", { name: "班聯統籌工作" }))
    .getByRole("button", { name: "幫同學代訂" })).toHaveAttribute("aria-pressed", "true");
});

it("點擊彙總或收款名單中的班級可查看同學明細", async () => {
  api.listOrderRecipients.mockResolvedValue([]);
  await openPage();
  fireEvent.click(screen.getByRole("radio", { name: "校慶" }));
  const summaryTable = await screen.findByRole("table", { name: "班級訂購與收款彙總" });
  fireEvent.click(within(summaryTable).getByRole("button", { name: "查看一年一班訂購明細" }));
  expect(await screen.findByRole("dialog", { name: "一年一班 · 訂購明細" })).toBeVisible();
  await screen.findByText("此班尚無名冊或有效訂購。");
  expect(api.listOrders).toHaveBeenCalledWith({ class_id: "class", activity_id: "festival", my_only: "false", limit: "500", offset: "0" });
  fireEvent.click(screen.getByRole("button", { name: "關閉" }));
  fireEvent.click(screen.getByRole("radio", { name: "校慶" }));
  const workspace = screen.getByRole("region", { name: "登記班級收款" });
  fireEvent.click(await within(workspace).findByRole("button", { name: "查看一年一班訂購明細" }));
  expect(await screen.findByRole("dialog", { name: "一年一班 · 訂購明細" })).toBeVisible();
});

it("only offers school-wide assisted ordering to order managers", async () => {
  access.isAdmin = false;
  access.permissions = new Set(["shop:view_all"]);
  const view = render(<CouncilOrdersPage />);
  await screen.findByText("一年一班");
  expect(screen.queryByRole("button", { name: "幫同學代訂" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "追加補收款" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "收款單據" })).not.toBeInTheDocument();
  access.permissions = new Set(["shop:manage_orders"]);
  view.rerender(<CouncilOrdersPage />);
  expect(screen.getByRole("button", { name: "幫同學代訂" })).toBeVisible();
});

describe("全校收款與訂單", () => {
  it("彙總載入失敗仍可獨立查每日收款，重新整理只刷新目前工作", async () => {
    api.orderSummary.mockRejectedValue(new Error("offline"));
    api.classPaymentReport.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    await openPage();
    fireEvent.click(screen.getByRole("radio", { name: "校慶" }));
    await screen.findByText("載入失敗，請重新整理後再試。");
    expect(api.classPaymentReport).not.toHaveBeenCalled();
    switchTask("每日收款");
    const report = screen.getByRole("region", { name: "每日收款" });
    expect(await within(report).findByRole("alert")).toHaveTextContent("無法載入班級收款明細");
    fireEvent.click(screen.getByRole("button", { name: "重新整理" }));
    expect(await within(report).findByRole("group", { name: "收款統計" })).toBeVisible();
    expect(api.classPaymentReport).toHaveBeenCalledTimes(2);
    expect(api.listOrders).not.toHaveBeenCalled();
  });

  it("依日期、活動、年級與班級搜尋每日收款明細", async () => {
    const now = new Date();
    api.classPaymentReport.mockResolvedValue([
      {
        record_id: "class-payment-one-festival", collection_type: "class",
        class_id: "class-one", class_label: "一年一班", grade: 1, activity_id: "festival",
        activity_label: "校慶", category_id: "shirts", category_label: "衣服", confirmed_at: now.toISOString(), amount: 100, order_count: 2,
      },
      {
        record_id: "class-payment-one-winter", collection_type: "class",
        class_id: "class-one", class_label: "一年一班", grade: 1, activity_id: "winter",
        activity_label: "冬季活動", category_id: "cards", category_label: "卡片", confirmed_at: now.toISOString(), amount: 50, order_count: 1,
      },
      {
        record_id: "class-payment-two-festival", collection_type: "class",
        class_id: "class-two", class_label: "二年一班", grade: 2, activity_id: "festival",
        activity_label: "校慶", category_id: "shirts", category_label: "衣服", confirmed_at: now.toISOString(), amount: 300, order_count: 3,
      },
      {
        record_id: "class-payment-old", collection_type: "class",
        class_id: "class-old", class_label: "三年一班", grade: 3, activity_id: "festival",
        activity_label: "校慶", category_id: "shirts", category_label: "衣服", confirmed_at: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
        amount: 900, order_count: 4,
      },
      {
        record_id: "individual-order-one", collection_type: "individual_order",
        class_id: "class-one", class_label: "一年一班", grade: 1, activity_id: "festival",
        activity_label: "校慶", category_id: "shirts", category_label: "衣服", confirmed_at: now.toISOString(), amount: 25, order_count: 1,
      },
    ]);
    await openPage();

    switchTask("每日收款");
    const report = screen.getByRole("region", { name: "每日收款" });
    const statistics = await within(report).findByRole("group", { name: "收款統計" });
    expect(await within(statistics).findByText("NT$475")).toBeVisible();
    expect(within(statistics).getByText("2 班")).toBeVisible();
    fireEvent.change(within(report).getByRole("combobox", { name: "收款活動" }), {
      target: { value: "shirts" },
    });
    fireEvent.change(within(report).getByRole("combobox", { name: "收款年級" }), {
      target: { value: "1" },
    });
    fireEvent.change(within(report).getByRole("searchbox", { name: "搜尋班級" }), {
      target: { value: "一年一班" },
    });

    expect(within(statistics).getByText("NT$125")).toBeVisible();
    expect(within(statistics).getByText("1 班")).toBeVisible();
    const details = within(report).getByRole("table", { name: "收款明細" });
    expect(details).toHaveTextContent("衣服");
    expect(within(details).getByText("一年一班（個人訂單）")).toBeVisible();
    expect(within(details).queryByText("卡片")).not.toBeInTheDocument();
  });

  it("同活動的不同活動與未綁活動的活動皆分開篩選，包含已下架活動", async () => {
    const now = new Date().toISOString();
    api.classPaymentReport.mockResolvedValue([
      { record_id: "dance-payment", collection_type: "class", class_id: "one", class_label: "一年一班", grade: 1,
        activity_id: "festival", activity_label: "校慶", category_id: "shirts", category_label: "衣服",
        confirmed_at: now, amount: 100, order_count: 1 },
      { record_id: "bag-payment", collection_type: "class", class_id: "one", class_label: "一年一班", grade: 1,
        activity_id: "festival", activity_label: "校慶", category_id: "bags", category_label: "袋子",
        confirmed_at: now, amount: 900, order_count: 1 },
      { record_id: "old-topic", collection_type: "individual_order", class_id: "one", class_label: "一年一班", grade: 1,
        activity_id: null, activity_label: "一般商品", category_id: "dance", category_label: "舞會",
        confirmed_at: now, amount: 300, order_count: 1 },
      { record_id: "other-topic", collection_type: "class", class_id: "one", class_label: "一年一班", grade: 1,
        activity_id: null, activity_label: "一般商品", category_id: "camp", category_label: "營隊",
        confirmed_at: now, amount: 700, order_count: 1 },
    ]);
    await openPage();
    switchTask("每日收款");
    const report = screen.getByRole("region", { name: "每日收款" });
    const statistics = await within(report).findByRole("group", { name: "收款統計" });
    expect(await within(statistics).findByText("NT$2,000")).toBeVisible();
    const picker = within(report).getByRole("combobox", { name: "收款活動" });
    expect(within(picker).queryByRole("option", { name: "校慶" })).not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "shirts" } });
    expect(within(statistics).getByText("NT$100")).toBeVisible();
    fireEvent.change(picker, { target: { value: "dance" } });
    expect(within(statistics).getByText("NT$300")).toBeVisible();
    const details = within(report).getByRole("table", { name: "收款明細" });
    expect(within(details).getByText("舞會")).toBeVisible();
    expect(within(details).queryByText("營隊")).not.toBeInTheDocument();
    fireEvent.click(within(report).getByRole("button", { name: "清除篩選" }));
    expect(within(statistics).getByText("NT$2,000")).toBeVisible();
  });

  it("已收齊的活動不再提供確認按鈕", async () => {
    await openPage();
    api.orderSummary.mockResolvedValue({ ...summary(), rows: [{ ...summary().rows[0], paid_amount: 300, unpaid_amount: 0 }] });
    fireEvent.click(screen.getByRole("radio", { name: "校慶" }));
    const workspace = screen.getByRole("region", { name: "登記班級收款" });
    expect(await within(workspace).findByText("已收齊")).toBeVisible();
    expect(within(workspace).queryByRole("button", { name: /核對.*收款/ })).not.toBeInTheDocument();
  });

  it("全校唯讀者可查看收款統計但不能確認收款", async () => {
    access.isAdmin = false;
    access.permissions = new Set(["shop:view_all"]);
    await openPage();

    switchTask("每日收款");
    expect(screen.getByRole("region", { name: "每日收款" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /確認.*收款/ })).not.toBeInTheDocument();
  });

  it("無法取得所選活動金額時不提供收款按鈕，並可重試", async () => {
    await openPage();
    api.orderSummary.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("radio", { name: "校慶" }));
    const workspace = screen.getByRole("region", { name: "登記班級收款" });
    expect(await within(workspace).findByRole("alert")).toHaveTextContent("無法載入本次活動");
    expect(within(workspace).queryByRole("button", { name: /核對.*收款/ })).not.toBeInTheDocument();
    fireEvent.click(within(workspace).getByRole("button", { name: "重試收款名單" }));
    expect(await within(workspace).findByRole("button", { name: "核對一年一班收款" })).toBeVisible();
  });

  it("沒有另外建立活動也能從結單設定全域鎖單商品批次", async () => {
    api.listActivities.mockResolvedValue([]);
    render(<CouncilOrdersPage />);
    switchTask("結單設定");
    const closure = await screen.findByRole("region", { name: "班聯結單與公開入口" });
    expect(closure).toBeVisible();
    expect(closure.closest("details")).toBeNull();
    expect(closure.compareDocumentPosition(screen.getByRole("navigation", { name: "班聯統籌工作" })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    const lock = within(closure).getByRole("button", { name: "結單並隱藏入口衣服" });
    await waitFor(() => expect(lock).toBeEnabled());
    api.closeCategory.mockImplementationOnce(async () => {
      api.getCloseStatus.mockResolvedValue({ statuses: { shirts: { is_closed: true, is_global: true }, bags: { is_closed: false }, cards: { is_closed: false } } });
      return {};
    });
    fireEvent.click(lock);
    expect(await within(closure).findByRole("status")).toHaveTextContent("商品已從公開目錄隱藏");
    expect(api.closeCategory).toHaveBeenCalledWith("shirts", {});
    expect(api.getCloseStatus).toHaveBeenCalledWith(["shirts", "bags", "cards"]);
    await waitFor(() => expect(api.catalog).toHaveBeenCalledTimes(2));
    expect(await within(closure).findByRole("button", { name: "重新開放並顯示衣服" })).toBeVisible();
  });

  it("唯讀班聯不顯示全域鎖單", async () => {
    access.isAdmin = false;
    access.permissions = new Set(["shop:view_all"]);
    render(<CouncilOrdersPage />);
    await screen.findByText("一年一班");
    expect(screen.queryByRole("region", { name: "活動結單與公開入口" })).not.toBeInTheDocument();
  });

  it.each(["shop:manage", "shop:manage_orders"])("具 %s 權限可直接找到全域鎖單", async (permission) => {
    access.isAdmin = false;
    access.permissions = new Set([permission]);
    render(<CouncilOrdersPage />);
    switchTask("結單設定");
    expect(await screen.findByRole("button", { name: "結單並隱藏入口衣服" })).toBeVisible();
  });

  it("downloads the chosen class and activity and shows a retryable receipt error", async () => {
    await openPage();
    fireEvent.click(screen.getByRole("radio", { name: "校慶" }));
    const workspace = screen.getByRole("region", { name: "登記班級收款" });
    const download = await within(workspace).findByRole("button", { name: "下載一年一班的校慶簽收單 PDF" });
    fireEvent.click(within(workspace).getByText("簽收單與其他操作"));
    api.downloadClassReceipt.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(download);
    expect(await screen.findByRole("alert")).toHaveTextContent("簽收單下載失敗，請重試。");
    expect(api.downloadClassReceipt).toHaveBeenCalledWith("class", "festival");
    expect(download).toHaveTextContent("重試");
    expect(api.setClassPaid).not.toHaveBeenCalled();
  });

  it("hides class receipts from read-only council users", async () => {
    access.isAdmin = false;
    access.permissions = new Set(["shop:view_all"]);
    await openPage();
    fireEvent.change(screen.getByRole("combobox", { name: "活動" }), { target: { value: "shirts" } });
    await waitFor(() => expect(api.getCloseStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /下載.*簽收單/ })).not.toBeInTheDocument();
  });

  it("downloads selected classes, all unpaid classes, or changed orders without confirming payment", async () => {
    api.orderSummary.mockResolvedValue({
      ...summary(),
      rows: [
        { key: "class-1", label: "一年一班", order_count: 1, item_count: 1, total_amount: 100, paid_amount: 0, unpaid_amount: 100 },
        { key: "class-2", label: "一年二班", order_count: 1, item_count: 1, total_amount: 200, paid_amount: 0, unpaid_amount: 200 },
      ],
    });
    api.downloadClassReceipts.mockResolvedValue(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    await openPage();
    switchTask("收款單據");
    const receiptTopic = screen.getByRole("combobox", { name: "收據活動" });
    expect(receiptTopic).toHaveTextContent("衣服");
    expect(receiptTopic).toHaveTextContent("袋子");
    expect(receiptTopic).toHaveTextContent("卡片");
    expect(receiptTopic).not.toHaveTextContent("校慶");
    fireEvent.change(receiptTopic, { target: { value: "shirts" } });

    fireEvent.click(await screen.findByRole("checkbox", { name: "選取一年一班收據" }));
    fireEvent.click(screen.getByRole("button", { name: "下載所選 1 班 PDF" }));
    await waitFor(() => expect(api.downloadClassReceipts).toHaveBeenCalledWith(
      { category_id: "shirts" }, ["class-1"],
    ));

    fireEvent.click(screen.getByRole("button", { name: "列印所有未繳款班級／個人收據" }));
    await waitFor(() => expect(api.downloadClassReceipts).toHaveBeenCalledWith(
      { category_id: "shirts" }, undefined, true,
    ));

    fireEvent.click(screen.getByRole("button", { name: "列印上次列印後有變更的班級／個人訂單" }));
    await waitFor(() => expect(api.downloadChangedOrderReceipts).toHaveBeenCalledWith(
      { category_id: "shirts" },
    ));
    expect(api.setClassPaid).not.toHaveBeenCalled();
  });

  const order = {
    id: "old-order", serial_number: "ORD-TEST", user_id: "buyer-1", user_name: "測試訂購人", class_label: null,
    status: "pending", total_price: 300, is_paid: false, is_class_collected: false,
    created_at: "2026-10-21T00:00:00Z",
  };

  it("creates one personalized reminder for each buyer with eligible unpaid orders", async () => {
    api.listOrders.mockResolvedValue([
      { ...order, id: "order-1", serial_number: "ORD-001", total_price: 300 },
      { ...order, id: "order-2", serial_number: "ORD-002", total_price: 200 },
      { ...order, id: "collected", user_id: "buyer-2", serial_number: "ORD-COLLECTED", is_class_collected: true },
      { ...order, id: "paid", user_id: "buyer-3", serial_number: "ORD-PAID", is_paid: true },
      { ...order, id: "cancelled", user_id: "buyer-4", serial_number: "ORD-CANCELLED", status: "cancelled" },
    ]);
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "查看待繳訂購人" }));
    await screen.findByText("ORD-001");
    fireEvent.click(screen.getByRole("button", { name: "建立訂購人提醒草稿" }));

    await waitFor(() => expect(api.createMessage).toHaveBeenCalledTimes(1));
    const draft = api.createMessage.mock.calls[0][0];
    expect(draft.recipients?.user_ids).toEqual(["buyer-1"]);
    expect(draft.recipient_variables).toEqual([
      expect.objectContaining({
        user_id: "buyer-1",
        variables: {
          order_details: expect.stringContaining("ORD-001"),
          unpaid_total: "NT$500",
          order_count: "2",
        },
      }),
    ]);
    expect(draft.recipient_variables[0].variables.order_details).toContain("ORD-002");
    expect(navigation.push).toHaveBeenCalledWith("/email?draft=reminder-draft-id");
  });

  it("creates personalized reminders for representatives of unpaid classes", async () => {
    api.orderSummary.mockResolvedValue({
      ...summary(),
      rows: [{ key: "class-1", label: "高一一班", order_count: 2, item_count: 2, total_amount: 500, paid_amount: 0, unpaid_amount: 500 }],
    });
    api.classRepresentativeReminderTargets.mockResolvedValue([
      { class_id: "class-1", class_label: "高一一班", user_id: "rep-1", user_name: "班代甲" },
    ]);
    await openPage();
    fireEvent.click(screen.getByRole("radio", { name: "校慶" }));
    const createDraft = await screen.findByRole("button", { name: "建立班代提醒草稿" });
    await waitFor(() => expect(createDraft).toBeEnabled());
    fireEvent.click(createDraft);

    await waitFor(() => expect(api.createMessage).toHaveBeenCalledTimes(1));
    const draft = api.createMessage.mock.calls[0][0];
    expect(draft.recipients?.user_ids).toEqual(["rep-1"]);
    expect(draft.recipient_variables[0]).toMatchObject({
      user_id: "rep-1",
      variables: {
        class_details: "高一一班：NT$500（2 筆）",
        unpaid_total: "NT$500",
        class_count: "1",
      },
    });
    expect(navigation.push).toHaveBeenCalledWith("/email?draft=reminder-draft-id");
  });

  async function openOrders(row = order) {
    api.listOrders.mockResolvedValue([row]);
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "查找訂單" }));
    await screen.findByText("ORD-TEST");
  }

  it("confirms cancellation with a reason and refreshes the order status", async () => {
    await openOrders();
    fireEvent.click(screen.getByRole("button", { name: "取消訂單 ORD-TEST" }));
    expect(api.cancelOrder).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "取消訂單" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("取消原因（選填）"), { target: { value: " 非在校生 " } });
    api.cancelOrder.mockResolvedValue({ ...order, status: "cancelled" });
    api.listOrders.mockResolvedValue([{ ...order, status: "cancelled" }]);
    fireEvent.click(screen.getByRole("button", { name: "確認取消訂單" }));
    await waitFor(() => expect(api.cancelOrder).toHaveBeenCalledWith("old-order", "非在校生"));
    expect(await screen.findByText("訂單 ORD-TEST 已取消。")).toHaveAttribute("role", "status");
    await waitFor(() => expect(screen.queryByRole("button", { name: "取消訂單 ORD-TEST" })).not.toBeInTheDocument());
  });

  it("lets order managers change one item quantity in the order list", async () => {
    const item = {
      id: "item-1", product_id: "shirt", product_name: "紀念衫", quantity: 2,
      unit_price: 100, subtotal: 200, selected_options: [],
    };
    const orderWithItem = { ...order, items: [item] };
    api.listOrders.mockResolvedValue([orderWithItem]);
    api.updateOrderItemQuantity.mockResolvedValue({
      ...orderWithItem,
      items: [{ ...item, quantity: 3, subtotal: 300 }],
      subtotal_price: 300,
      discount_amount: 0,
      total_price: 300,
    });
    await openOrders(orderWithItem);

    fireEvent.click(screen.getByRole("button", { name: "調整數量" }));
    const quantity = screen.getByRole("spinbutton", { name: "訂購數量" });
    fireEvent.change(quantity, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "更新數量" }));

    await waitFor(() => expect(api.updateOrderItemQuantity).toHaveBeenCalledWith("old-order", "item-1", 3));
    expect(await screen.findByText("已更新「測試訂購人」的訂購數量。")).toHaveAttribute("role", "status");
  });

  it("keeps the reason and allows retry after cancellation fails", async () => {
    await openOrders();
    fireEvent.click(screen.getByRole("button", { name: "取消訂單 ORD-TEST" }));
    fireEvent.change(screen.getByLabelText("取消原因（選填）"), { target: { value: "資格不符" } });
    api.cancelOrder.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "確認取消訂單" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("取消失敗，請稍後再試。");
    expect(screen.getByLabelText("取消原因（選填）")).toHaveValue("資格不符");
    expect(screen.getByRole("button", { name: "確認取消訂單" })).toBeEnabled();
  });

  it("prevents another submission while cancellation is pending", async () => {
    await openOrders();
    fireEvent.click(screen.getByRole("button", { name: "取消訂單 ORD-TEST" }));
    let finish!: () => void;
    api.cancelOrder.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "確認取消訂單" }));
    expect(screen.getByRole("button", { name: "取消中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "返回" })).toBeDisabled();
    await act(async () => finish());
    expect(api.cancelOrder).toHaveBeenCalledTimes(1);
  });

  it("does not cancel when returning from the confirmation", async () => {
    await openOrders();
    fireEvent.click(screen.getByRole("button", { name: "取消訂單 ORD-TEST" }));
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.cancelOrder).not.toHaveBeenCalled();
  });

  it("hides cancellation for a read-only user", async () => {
    access.isAdmin = false;
    access.permissions = new Set(["shop:view_all"]);
    await openOrders();
    expect(screen.queryByRole("button", { name: "取消訂單 ORD-TEST" })).not.toBeInTheDocument();
  });

  it("explains why a collected order cannot be cancelled", async () => {
    api.listOrders.mockResolvedValue([{ ...order, is_class_collected: true }]);
    await openPage();
    fireEvent.click(screen.getByRole("button", { name: "查找訂單" }));
    expect(await screen.findByText("已收款，請先撤銷收款再調整或取消")).toBeVisible();
    expect(screen.queryByRole("button", { name: "取消訂單 ORD-TEST" })).not.toBeInTheDocument();
  });

  it("先選擇單一活動，核對後只送出目前活動", async () => {
    await openPage();
    const workspace = screen.getByRole("region", { name: "登記班級收款" });
    expect(within(workspace).queryByRole("button", { name: /核對.*收款/ })).not.toBeInTheDocument();
    fireEvent.click(within(workspace).getByRole("radio", { name: "校慶" }));
    fireEvent.click(await within(workspace).findByRole("button", { name: "核對一年一班收款" }));
    const dialog = screen.getByRole("dialog", { name: "核對班級收款" });
    expect(dialog).toHaveTextContent("校慶");
    expect(dialog).not.toHaveTextContent("冬季活動");
    expect(api.setClassPaid).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "確認收到款項" }));
    await waitFor(() => expect(api.setClassPaid).toHaveBeenCalledWith("class", true, "festival", undefined));
    expect(api.setClassPaid).toHaveBeenCalledTimes(1);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("切換活動會取代前一活動，不會合併收款金額", async () => {
    await openPage();
    api.orderSummary.mockImplementation(async (params: { activity_id?: string }) => ({
      ...summary(), rows: [{ ...summary().rows[0], total_amount: params.activity_id === "winter" ? 100 : 300,
        unpaid_amount: params.activity_id === "winter" ? 100 : 300 }],
    }));
    const workspace = screen.getByRole("region", { name: "登記班級收款" });
    fireEvent.click(within(workspace).getByRole("radio", { name: "校慶" }));
    fireEvent.click(within(workspace).getByRole("radio", { name: "冬季活動" }));
    fireEvent.click(await within(workspace).findByRole("button", { name: "核對一年一班收款" }));
    const dialog = screen.getByRole("dialog", { name: "核對班級收款" });
    expect(dialog).not.toHaveTextContent("校慶");
    expect(dialog).toHaveTextContent("冬季活動NT$100");
    expect(dialog).toHaveTextContent("本次合計NT$100");
    expect(within(workspace).getByRole("radio", { name: "校慶", hidden: true })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "確認收到款項" }));
    await waitFor(() => expect(api.setClassPaid).toHaveBeenCalledTimes(1));
    expect(api.setClassPaid).not.toHaveBeenCalledWith("class", true, "festival", undefined);
    expect(api.setClassPaid).toHaveBeenCalledWith("class", true, "winter", undefined);
  });

  it("未綁活動的傳情與舞會分開，只收勾選活動", async () => {
    api.catalog.mockResolvedValue([
      { id: "love", name: "傳情", activity_id: null, series: [], products: [] },
      { id: "dance", name: "舞會", activity_id: null, series: [], products: [] },
    ]);
    api.listActivities.mockResolvedValue([]);
    await openPage();
    const workspace = screen.getByRole("region", { name: "登記班級收款" });
    fireEvent.click(within(workspace).getByRole("radio", { name: "傳情" }));
    fireEvent.click(await within(workspace).findByRole("button", { name: "核對一年一班收款" }));
    const dialog = screen.getByRole("dialog", { name: "核對班級收款" });
    expect(dialog).not.toHaveTextContent("舞會");
    fireEvent.click(within(dialog).getByRole("button", { name: "確認收到款項" }));
    await waitFor(() => expect(api.setClassPaid).toHaveBeenCalledWith("class", true, null, "love"));
    expect(api.setClassPaid).toHaveBeenCalledTimes(1);
  });

  it("目前活動收款失敗時保留核對內容，重試只送出此活動", async () => {
    await openPage();
    api.setClassPaid.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    const workspace = screen.getByRole("region", { name: "登記班級收款" });
    fireEvent.click(within(workspace).getByRole("radio", { name: "冬季活動" }));
    fireEvent.click(await within(workspace).findByRole("button", { name: "核對一年一班收款" }));
    fireEvent.click(screen.getByRole("button", { name: "確認收到款項" }));
    expect(await screen.findByText(/0 個活動已完成，1 個未完成/)).toHaveAttribute("role", "alert");
    const dialog = screen.getByRole("dialog", { name: "核對班級收款" });
    expect(dialog).not.toHaveTextContent("校慶");
    expect(dialog).toHaveTextContent("冬季活動");
    fireEvent.click(within(dialog).getByRole("button", { name: "確認收到款項" }));
    await waitFor(() => expect(api.setClassPaid).toHaveBeenCalledTimes(2));
    expect(api.setClassPaid.mock.calls.every((call) => call[2] === "winter")).toBe(true);
  });

  it("取消核對不更新款項，送出期間不能重複提交或關閉", async () => {
    await openPage();
    const workspace = screen.getByRole("region", { name: "登記班級收款" });
    fireEvent.click(within(workspace).getByRole("radio", { name: "校慶" }));
    fireEvent.click(await within(workspace).findByRole("button", { name: "核對一年一班收款" }));
    fireEvent.click(screen.getByRole("button", { name: "返回核對" }));
    expect(api.setClassPaid).not.toHaveBeenCalled();
    fireEvent.click(within(workspace).getByRole("button", { name: "核對一年一班收款" }));
    let finish!: () => void;
    api.setClassPaid.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "確認收到款項" }));
    expect(screen.getByRole("button", { name: "處理中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "返回核對" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeVisible();
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.setClassPaid).toHaveBeenCalledTimes(1);
  });

  it("切換勾選時忽略舊活動回應，避免用過期金額收款", async () => {
    await openPage();
    let resolveOld!: (value: ReturnType<typeof summary>) => void;
    api.orderSummary.mockImplementation((params: { activity_id?: string }) => params.activity_id === "festival"
      ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(summary("最新班級")));
    const workspace = screen.getByRole("region", { name: "登記班級收款" });
    fireEvent.click(within(workspace).getByRole("radio", { name: "校慶" }));
    expect(within(workspace).getByRole("status")).toHaveTextContent("正在載入所選活動");
    fireEvent.click(within(workspace).getByRole("radio", { name: "校慶" }));
    fireEvent.click(within(workspace).getByRole("radio", { name: "冬季活動" }));
    expect(await within(workspace).findByRole("button", { name: "核對最新班級收款" })).toBeVisible();
    await act(async () => resolveOld(summary("過期班級")));
    expect(within(workspace).queryByText("過期班級")).not.toBeInTheDocument();
  });

  it("活動選單逐一列出活動，切換活動會清除商品並在各分頁用活動篩選", async () => {
    api.catalog.mockResolvedValue([
      ...await api.catalog(),
      { id: "general", name: "一般活動", activity_id: null, series: [], products: [] },
    ]);
    await openPage();
    switchTask("商品總量");
    const select = screen.getByRole("combobox", { name: "活動" });
    expect(select).toHaveTextContent("衣服");
    expect(select).toHaveTextContent("袋子");
    expect(select).toHaveTextContent("一般活動");
    expect(select).not.toHaveTextContent("校慶");
    expect(screen.getAllByRole("combobox", { name: "活動" })).toHaveLength(1);
    fireEvent.change(select, { target: { value: "shirts" } });
    fireEvent.change(screen.getByRole("combobox", { name: "商品" }), { target: { value: "shirt" } });
    fireEvent.change(select, { target: { value: "bags" } });
    await waitFor(() => expect(api.orderQuantities).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: "bags" })));
    expect(api.orderQuantities.mock.lastCall?.[0]).not.toHaveProperty("product_id");
    expect(api.orderQuantities.mock.lastCall?.[0]).not.toHaveProperty("activity_id");
    expect(screen.getByRole("combobox", { name: "商品" })).toHaveValue("");
    expect(screen.queryByRole("option", { name: "紀念衫" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "商品總量" }));
    await waitFor(() => expect(api.orderQuantities).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: "bags" })));
    fireEvent.click(screen.getByRole("button", { name: "查找訂單" }));
    await waitFor(() => expect(api.listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: "bags" })));
    fireEvent.change(select, { target: { value: "general" } });
    await waitFor(() => expect(api.listOrders).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: "general" })));
    fireEvent.click(screen.getByRole("button", { name: "清除篩選" }));
    await waitFor(() => expect(api.listOrders.mock.lastCall?.[0]).not.toHaveProperty("category_id"));
  });

  it("ignores an older response after switching activity", async () => {
    await openPage();
    let resolveOld!: (value: ReturnType<typeof summary>) => void;
    api.orderSummary.mockImplementation((params: { activity_id?: string }) => params.activity_id === "festival"
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve(summary("最新班級")));
    fireEvent.click(screen.getByRole("radio", { name: "校慶" }));
    fireEvent.click(screen.getByRole("radio", { name: "冬季活動" }));
    await screen.findAllByText("最新班級");
    await act(async () => resolveOld(summary("過期班級")));
    expect(screen.queryByText("過期班級")).not.toBeInTheDocument();
  });

  it("班聯透過確認收款鎖單，沒有手動班級開關", async () => {
    await openPage();
    fireEvent.click(screen.getByRole("radio", { name: "校慶" }));
    expect(await screen.findByRole("button", { name: "核對一年一班收款" })).toBeVisible();
    expect(screen.queryByText("批次管理訂購")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "整批停止訂購" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停止訂購" })).not.toBeInTheDocument();
  });

  it("does not present an unavailable closure status as open", async () => {
    api.getCloseStatus.mockRejectedValue(new Error("offline"));
    await openPage();
    fireEvent.click(screen.getByRole("radio", { name: "校慶" }));

    await waitFor(() => expect(api.getCloseStatus).toHaveBeenCalled());
    expect(screen.getAllByText("狀態待確認").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "停止訂購" })).not.toBeInTheDocument();
  });
});
