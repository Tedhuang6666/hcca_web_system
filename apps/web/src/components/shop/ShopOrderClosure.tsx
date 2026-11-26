import { CircleAlert } from "lucide-react";

import type { CloseStatusItem } from "@/lib/types";

export function formatShopTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "時間無法辨識";
  return timestamp.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

export function resolveOrderClosureState(
  status: CloseStatusItem | undefined,
  categoryClosedAt: string | null,
  now = Date.now(),
) {
  const deadline = status?.closes_at ?? null;
  const closedAt = categoryClosedAt ?? (status?.is_global ? status.closed_at : null);
  const deadlinePassed = Boolean(deadline && new Date(deadline).getTime() <= now);
  const closedAtMatchesDeadline = Boolean(
    deadline && closedAt
      && new Date(deadline).getTime() === new Date(closedAt).getTime(),
  );
  const deadlineClosure = deadlinePassed && (!closedAt || closedAtMatchesDeadline);
  const councilClosed = Boolean(
    (categoryClosedAt || status?.is_global) && !deadlineClosure,
  );
  const classPaid = Boolean(status?.is_closed && !status.is_global);
  return {
    deadline,
    closedAt: closedAt ?? (deadlinePassed ? deadline : null),
    deadlinePassed,
    councilClosed,
    classPaid,
    isClosed: councilClosed || classPaid || deadlinePassed,
  };
}

export function OrderClosureNotice({
  status,
  categoryClosedAt,
}: {
  status: CloseStatusItem | undefined;
  categoryClosedAt: string | null;
}) {
  const closure = resolveOrderClosureState(status, categoryClosedAt);
  if (!closure.isClosed) return null;

  const collectionTime = formatShopTimestamp(status?.class_collected_at);
  const confirmationTime = formatShopTimestamp(
    status?.council_confirmed_at ?? (!status?.is_global ? status?.closed_at : null),
  );
  const closureTime = formatShopTimestamp(closure.closedAt);
  const heading = closure.councilClosed
    ? "班聯已結單"
    : closure.classPaid
      ? "班聯已確認本班收款"
    : "商品分類已到結單時間";
  const description = closure.councilClosed
    ? "此分類商品已從公開目錄隱藏；此連結僅供查看商品與結單紀錄。"
    : closure.classPaid
      ? "本班此分類的商品登記已暫停，其他班級仍可訂購。"
      : "此分類商品已停止登記。";

  return (
    <section className="shop-product-closed-note" aria-label="商品分類結單與收款狀態" role="status">
      <div className="shop-product-closed-heading">
        <CircleAlert size={18} aria-hidden="true" />
        <div>
          <h4>{heading}</h4>
          <p>{description}</p>
        </div>
      </div>
      <dl className="shop-product-closed-times">
        <div>
          <dt>班代收款時間</dt>
          <dd>{collectionTime ?? (status ? "尚無收款紀錄" : "目前無法確認班級紀錄")}</dd>
        </div>
        <div>
          <dt>班聯確認時間</dt>
          <dd>{confirmationTime ?? (status ? "尚未確認收款" : "目前無法確認班級紀錄")}</dd>
        </div>
        {closureTime && <div>
          <dt>結單時間</dt>
          <dd>{closureTime}</dd>
        </div>}
      </dl>
    </section>
  );
}
