import Link from "next/link";

export type ShopWorkflowPage = "admin" | "council";
export type ShopWorkflowAccess = { manage: boolean; confirm: boolean; report: boolean };

type Need = keyof ShopWorkflowAccess | "view";
type Step = { page: ShopWorkflowPage; key: string; label: string; need: Need };

export const SHOP_WORKFLOW_STAGES: { label: string; steps: Step[] }[] = [
  {
    label: "商品準備",
    steps: [
      { page: "admin", key: "catalog", label: "商品設定", need: "manage" },
      { page: "admin", key: "promotions", label: "優惠設定", need: "manage" },
      { page: "admin", key: "offices", label: "教師處室", need: "manage" },
      { page: "admin", key: "imports", label: "組織預購同步", need: "manage" },
    ],
  },
  {
    label: "訂購與結單",
    steps: [
      { page: "council", key: "orders", label: "查找訂單", need: "view" },
      { page: "council", key: "assisted", label: "幫同學代訂", need: "confirm" },
      { page: "admin", key: "note-groups", label: "依備註查看名單", need: "manage" },
      { page: "council", key: "closure", label: "結單設定", need: "confirm" },
    ],
  },
  {
    label: "收款與收據",
    steps: [
      { page: "council", key: "summary", label: "班級繳款", need: "view" },
      { page: "council", key: "receipts", label: "收款單據", need: "confirm" },
      { page: "council", key: "supplements", label: "追加補收款", need: "confirm" },
      { page: "council", key: "daily", label: "每日收款", need: "report" },
    ],
  },
  {
    label: "總額與報表",
    steps: [
      { page: "council", key: "quantities", label: "商品總量", need: "view" },
      { page: "council", key: "distribution", label: "分貨統計", need: "view" },
      { page: "council", key: "analytics", label: "銷售分析", need: "view" },
      { page: "council", key: "profit", label: "盈利與備貨", need: "manage" },
      { page: "admin", key: "stats", label: "進階訂購統計", need: "manage" },
    ],
  },
];

export function shopWorkflowSteps(page: ShopWorkflowPage, access: ShopWorkflowAccess) {
  return SHOP_WORKFLOW_STAGES.flatMap((stage) => stage.steps)
    .filter((step) => step.page === page && (step.need === "view" || access[step.need]));
}

function stepHref(step: Step) {
  if (step.page === "admin") return step.key === "catalog" ? "/shop/admin" : `/shop/admin?view=${step.key}`;
  return `/shop/council-orders?tab=${step.key}`;
}

/** 商品後台依「準備 → 訂購 → 收款 → 報表」排列；同頁步驟用按鈕切換，跨頁步驟用連結。 */
export default function ShopWorkflowNav({
  page,
  current,
  access,
  disabled = false,
  onSelect,
}: {
  page: ShopWorkflowPage;
  current: string;
  access: ShopWorkflowAccess;
  disabled?: boolean;
  onSelect?: (key: string) => void;
}) {
  const stages = SHOP_WORKFLOW_STAGES.map((stage) => ({
    ...stage,
    steps: stage.steps.filter((step) => step.need === "view" || access[step.need]),
  })).filter((stage) => stage.steps.length > 0);

  return (
    <nav className="shop-workflow" aria-label="商品作業流程">
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((stage, index) => {
          const activeStage = stage.steps.some((step) => step.page === page && step.key === current);
          return (
            <li key={stage.label} className="shop-workflow-stage" data-active={activeStage || undefined}>
              <p className="shop-workflow-stage-label">
                <span aria-hidden>{index + 1}</span>
                {stage.label}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {stage.steps.map((step) => {
                  const active = step.page === page && step.key === current;
                  return (
                    <li key={`${step.page}:${step.key}`}>
                      {step.page === page && onSelect ? (
                        <button id={`${page}-task-${step.key}`} type="button" disabled={disabled}
                          aria-pressed={active} onClick={() => onSelect(step.key)}>
                          {step.label}
                        </button>
                      ) : (
                        <Link href={stepHref(step)} aria-current={active ? "page" : undefined}>
                          {step.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
