/** 商品登記頁共用的變體識別與鎖定說明。 */

export function registrationVariantKey(options: readonly { option_id: string }[]) {
  return options.map((option) => option.option_id).sort().join(",");
}

export function registrationLockMessage({
  registrationLocked,
  classClosed,
  councilClosed = false,
  deadlinePassed,
}: {
  registrationLocked: boolean;
  classClosed: boolean;
  councilClosed?: boolean;
  deadlinePassed: boolean;
}) {
  if (registrationLocked) return "班代已登記這筆收款，無法再修改商品數量";
  if (councilClosed) return "班聯已結單，此活動商品已停止訂購";
  if (classClosed) return "班聯已確認本班收款，此活動商品已停止訂購";
  if (deadlinePassed) return "活動已到統一結單時間，商品停止登記";
  return "登入後即可登記商品";
}
