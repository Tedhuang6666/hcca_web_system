import type { ShopProfitProduct } from "@/lib/types";

export function stockScenario(row: ShopProfitProduct, quantity: number, price: number) {
  const extraRevenue = quantity * price;
  const gap = row.profit_amount == null ? null : Math.max(0, -row.profit_amount);
  return {
    extraRevenue,
    profit: row.profit_amount == null ? null : row.profit_amount + extraRevenue,
    breakEvenUnits: gap == null || (gap > 0 && price === 0)
      ? null : gap === 0 ? 0 : Math.ceil(gap / price),
  };
}

export function profitCsv(products: ShopProfitProduct[], category: string) {
  const rows: (string | number)[][] = [
    ["盈利與備貨", category, "全期有效訂單；庫存未計收入；金額單位 NT$"],
    ["商品", "單位成本", "起訂量", "班聯加購囤貨", "不可售備用品", "額外費用", "訂單選項成本", "訂單件數",
      "起訂補足", "採購件數", "可售餘貨", "訂單收入", "已確認收款", "整批成本", "預估盈利", "備註"],
    ...products.map((row) => [row.name, row.plan.unit_cost ?? "未設定", row.plan.minimum_order_quantity,
      row.plan.stock_extra_quantity, row.plan.reserve_quantity, row.plan.extra_cost, row.option_cost ?? "未設定",
      row.ordered_quantity, row.minimum_top_up_quantity, row.purchase_quantity,
      row.sellable_stock_quantity, row.revenue, row.paid_amount, row.total_cost ?? "未設定",
      row.profit_amount ?? "未設定", row.plan.note]),
    [],
    ["商品", "選項群組", "選項", "額外單位成本", "訂單選用件數", "選項成本合計"],
    ...products.flatMap((row) => row.options.map((option) => [row.name, option.group_name,
      option.value, option.unit_cost ?? "未設定", option.ordered_quantity, option.total_cost ?? "未設定"])),
  ];
  return "\uFEFF" + rows.map((row) => row.map((value) => {
    // Excel 等試算表仍會執行引號內的公式，文字值需先加單引號。
    const text = typeof value === "string" && /^[\s]*[=+\-@]/.test(value) ? `'${value}` : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
}
